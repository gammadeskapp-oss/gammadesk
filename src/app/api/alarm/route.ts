import { NextResponse } from 'next/server';
import { runCronAlarm } from '@/lib/cronAlarm';
import { marketSessionRules } from '@/lib/events';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { inSession } from '@/lib/staleness';
import { formatEtClock } from '@/lib/scanner/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Pages Discord when a scheduled job has stopped writing.
 * Driven by Vercel Cron — see `vercel.json`.
 *
 * Every other job here produces data. This one reads what they produced and
 * says nothing at all on a healthy day, which is the whole point: the failure
 * it exists to catch is silent, and the previous way of noticing it was to
 * open a page and read a timestamp.
 *
 * `?dry=1` grades and returns the message without posting. `?force=1` runs
 * outside session hours.
 *
 * ## Why the session gate lives here and not in the cron expression
 *
 * The expression could be narrowed to the session, but it would only be right
 * for half the year — the same daylight-saving problem every other fixed-time
 * job here has. Registering it across a wide UTC span and letting the New York
 * clock decide is the pattern the breadth and retest jobs already use, and it
 * is correct under both offsets.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';
  const now = new Date();
  const rules = marketSessionRules();

  if (!force && !inSession(now, rules)) {
    return NextResponse.json({
      status: 'skipped',
      summary: `Skipped: New York time is ${formatEtClock(now)}, outside the session. A late job is only actionable while there is a session left to salvage.`,
    });
  }

  try {
    const run = await runCronAlarm(now, rules, { dry });

    return NextResponse.json({
      status: run.posted ? 'alerted' : run.message ? 'not-delivered' : 'quiet',
      etClock: formatEtClock(now),
      opened: run.opened,
      repeated: run.repeated,
      /*
       * Reported even though nothing was sent for these. "We know it is down
       * and are deliberately not repeating yet" and "we have lost track of it"
       * look identical from the channel, and only one of them is fine.
       */
      suppressed: run.suppressed,
      recovered: run.recovered,
      discord: run.delivery,
      // Exactly what was, or would have been, posted.
      message: run.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Cron alarm failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
