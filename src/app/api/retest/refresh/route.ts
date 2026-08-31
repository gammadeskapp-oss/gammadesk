import { NextResponse } from 'next/server';
import { isRegularHours } from '@/lib/breadth';
import { config } from '@/lib/config';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { refreshRetests, storeStatus } from '@/lib/retest';
import { formatEtClock } from '@/lib/scanner/schedule';
import { normaliseSymbol } from '@/lib/ticker/bars';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The failed-retest refresh — see `vercel.json`.
 *
 * Runs every minute while the market is open, on the same reasoning as the
 * breadth job: there is no single clock time for it to land on, so it carries
 * the New York hours check but no drift guard. A run two minutes late still
 * folds in every bar it missed, because the level states carry forward and
 * each refresh processes only the bars it has not already seen.
 *
 * `?symbol=` watches a ticker other than the configured one; `?force=1` runs
 * outside market hours, for testing.
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

  const symbol = normaliseSymbol(params.get('symbol') ?? config.symbol);
  if (!symbol) {
    return NextResponse.json({ error: 'Invalid symbol.' }, { status: 400 });
  }

  try {
    const result = await refreshRetests(symbol, now);
    return NextResponse.json({
      status: 'ok',
      symbol: result.symbol,
      etClock: formatEtClock(now),
      firedThisRun: result.fired.length,
      events: result.fired.map((e) => ({
        level: e.levelPrice,
        label: e.label,
        direction: e.direction,
        outcome: e.outcome,
        at: e.etClock,
        regime: e.regime,
      })),
      levelsWatched: result.levels,
      bars: result.bars,
      source: result.source,
      notes: result.notes,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Retest refresh failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
