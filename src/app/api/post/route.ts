import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import {
  buildDiscordMessage,
  generateAndStorePost,
  postToDiscord,
  readPosts,
  storeStatus,
} from '@/lib/post';
import { checkSchedule } from '@/lib/scanner/schedule';
import { marketToday } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Builds the morning X post, stores it, and sends it to Discord.
 * Driven by Vercel Cron — see `vercel.json`.
 *
 * `?dry=1` builds and stores without posting, for checking the wording first.
 * `?force=1` posts again on a day that already went out.
 *
 * ## Daylight saving
 *
 * Vercel schedules crons in UTC only, so a single entry cannot be 09:00 New
 * York all year: 13:00 UTC is 09:00 ET in summer and 08:00 ET in winter. The
 * previous version registered only 13:00 and refused to run before 9am local,
 * which meant that from November to March the job fired, was refused, returned
 * HTTP 200, and the morning post never went out — a silent failure that looked
 * like a successful cron on the dashboard.
 *
 * It now uses the same pattern as the two scanner jobs: `vercel.json` registers
 * **both** candidate UTC times, each carrying `?when=scheduled`, and the guard
 * below lets through only the one where the New York clock actually reads the
 * configured time. The other fires, sees the wrong hour, and returns having
 * spent nothing.
 *
 * The check is two-sided on purpose. A one-sided "not before 9am" test would
 * let the summer 14:00 entry through at 10:00 ET and publish a morning post an
 * hour late under a 09:00 heading. The date idempotency below would usually
 * catch that, but relying on it would mean the very first post of the day
 * could be the late one.
 */
const POST_TIME_ET = '09:00';

export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  const today = marketToday();

  /*
   * Only the scheduled entries are gated. A manual call omits `when=scheduled`
   * and is never blocked, which is how a missed morning gets re-run by hand.
   */
  if (!force && params.get('when') === 'scheduled') {
    const check = checkSchedule(POST_TIME_ET, new Date());
    if (!check.due) {
      return NextResponse.json({
        status: 'skipped',
        reason: `It is ${check.nowEt} in New York; the morning post is scheduled for ${POST_TIME_ET} ET.`,
        date: today,
      });
    }
  }

  try {
    // Idempotent by date: a second firing on the same morning stores nothing
    // new and posts nothing.
    if (!force) {
      const existing = (await readPosts()).find((p) => p.date === today);
      if (existing) {
        return NextResponse.json({
          status: 'already-posted',
          date: today,
          generatedAt: existing.generatedAt,
          message: await buildDiscordMessage(existing),
        });
      }
    }

    const post = await generateAndStorePost();
    const delivery = dry
      ? { delivered: false, reason: 'Dry run — nothing was posted.' }
      : await postToDiscord(post);

    return NextResponse.json({
      status: 'generated',
      date: post.date,
      generatedAt: post.generatedAt,
      length: post.length,
      discord: delivery,
      // Exactly what was, or would have been, sent.
      text: post.text,
      message: await buildDiscordMessage(post),
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Morning post generation failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
