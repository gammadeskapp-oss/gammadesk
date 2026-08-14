import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import {
  buildDiscordMessage,
  generateAndStorePost,
  postToDiscord,
  readPosts,
  storeStatus,
} from '@/lib/post';
import { marketNow, marketToday } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Builds the morning X post, stores it, and sends it to Discord.
 * Driven by Vercel Cron — see `vercel.json`.
 *
 * `?dry=1` builds and stores without posting, for checking the wording first.
 * `?force=1` posts again on a day that already went out.
 *
 * Vercel schedules crons in UTC only, so the entry fires at 09:00 New York
 * time from March to November and 08:00 for the rest of the year. Rather than
 * spend a second cron slot on the winter hour, this refuses to run before 9am
 * local unless forced — so adding a 14:00 UTC entry later makes it correct
 * year-round with no risk of two posts in one morning.
 */
const EARLIEST_HOUR = 9;

export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  const now = marketNow();
  const today = marketToday();

  if (!force && now.hour < EARLIEST_HOUR) {
    return NextResponse.json({
      status: 'skipped',
      reason: `It is ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')} in New York; the morning post waits until ${EARLIEST_HOUR}:00.`,
      date: today,
    });
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
