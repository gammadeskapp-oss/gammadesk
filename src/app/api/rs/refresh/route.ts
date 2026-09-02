import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { storeStatus } from '@/lib/jsonStore';
import { refreshShard } from '@/lib/rs/refresh';
import { SHARDS } from '@/lib/rs/universe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Refreshes one shard of the relative-strength price history.
 *
 * Driven by Vercel Cron — see `vercel.json`. Each firing takes the next shard
 * from a stored cursor, so four firings cover the whole S&P 500 once a day
 * without any single run fetching more than about 125 symbols.
 *
 * ## Why four separate cron entries rather than one `0,15,30,45` schedule
 *
 * This split dates from when the project was on Vercel's Hobby plan, which
 * restricts both how often a cron may be *expressed* and when it actually
 * fires. **The project is on Pro now**, so neither restriction applies and the
 * split is no longer required — it is kept because it works and because
 * collapsing it is a change with no benefit attached, not because the plan
 * still demands it. Anyone tempted to reason from this comment about what
 * Vercel allows should check the current plan first; `/api/breadth/refresh`
 * and `/api/alarm` both use multi-fire expressions.
 *
 * What the split still buys, independent of plan: the four runs are two hours
 * apart, and two concurrent runs would read the same cursor, refresh the same
 * shard twice and skip another. Wide spacing makes that overlap impossible
 * whatever the scheduler's timing guarantees happen to be. The later three run
 * on days 2-6 because they fall after midnight UTC — they are still the same
 * weekday *evening* in New York.
 *
 * Pass `?shard=N` to force a particular shard, which is useful for filling a
 * fresh deploy by hand without waiting four nights for the cursor to come
 * round. Safe to run repeatedly: a re-run simply refetches the same tails.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const raw = new URL(request.url).searchParams.get('shard');
  const forced = raw === null ? undefined : Number(raw);

  if (forced !== undefined && (!Number.isInteger(forced) || forced < 0 || forced >= SHARDS)) {
    return NextResponse.json(
      { error: `shard must be an integer from 0 to ${SHARDS - 1}.` },
      { status: 400 },
    );
  }

  try {
    const report = await refreshShard(forced);
    return NextResponse.json({ status: 'refreshed', ...report, store: storeStatus() });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Relative-strength refresh failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
