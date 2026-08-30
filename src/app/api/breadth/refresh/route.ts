import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { isRegularHours, refreshBreadth, storeStatus } from '@/lib/breadth';
import { formatEtClock } from '@/lib/scanner/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The breadth refresh — see `vercel.json`.
 *
 * Runs every minute while the market is open. Unlike the fixed-time jobs there
 * is no single clock time for it to land on, so it carries no
 * `checkSchedule` drift guard: a run that arrives two minutes late is still a
 * perfectly good sample, it simply stamps itself with the time it actually
 * took. What it does share with them is the New York clock check — the cron
 * entry covers a UTC span wide enough to hold the session under either
 * daylight-saving offset, and `isRegularHours` decides which firings are
 * really inside it.
 *
 * `?force=1` runs outside those hours, for testing.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const now = new Date();

  if (params.get('force') !== '1' && !isRegularHours(now)) {
    return NextResponse.json({
      status: 'skipped',
      summary: `Skipped: New York time is ${formatEtClock(now)}, outside 09:30-16:00 on a weekday.`,
    });
  }

  try {
    const result = await refreshBreadth(now);
    return NextResponse.json({
      status: result.stored ? 'stored' : 'nothing-stored',
      etClock: formatEtClock(now),
      breadthPct:
        result.sample === null ? null : Number(result.sample.pctAbovePriorClose.toFixed(1)),
      measured: result.measured,
      universe: result.universe,
      requests: result.requests,
      notes: result.notes,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Breadth refresh failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
