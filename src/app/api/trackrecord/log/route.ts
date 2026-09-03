import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { storeStatus } from '@/lib/jsonStore';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { checkSchedule } from '@/lib/scanner/schedule';
import { logTodaysPicks } from '@/lib/trackRecord/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The 16:15 ET job: write the day's top five scanner rows into the permanent
 * record. See `vercel.json`, which registers both candidate UTC times.
 *
 * ## Why the schedule guard matters more here than anywhere else
 *
 * Vercel's cron lines are UTC, so one entry is 16:15 New York in summer and
 * 15:15 in winter — before the bell. This job's whole output is a *closing*
 * price, and one that ran forty-five minutes early would write an intraday
 * quote into a permanent record under the heading "close", where nothing later
 * would ever contradict it. So both times are registered and this guard lets
 * through only the one where the New York clock actually reads 16:15.
 *
 * A manual call omits `when=scheduled` and always runs, which is how a missed
 * evening is caught up.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;

  if (params.get('when') === 'scheduled') {
    const check = checkSchedule(config.trackRecord.logTimeEt, new Date());
    if (!check.due) {
      return NextResponse.json({
        status: 'skipped',
        summary: `Skipped: New York time is ${check.nowEt}, scheduled for ${config.trackRecord.logTimeEt} ET.`,
        nowEt: check.nowEt,
      });
    }
  }

  try {
    const result = await logTodaysPicks();
    return NextResponse.json({
      ...result,
      summary: result.alreadyLogged
        ? `${result.date} was already logged; nothing was rewritten.`
        : `Logged ${result.logged.length} picks for ${result.date}.`,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Logging the day’s picks failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
