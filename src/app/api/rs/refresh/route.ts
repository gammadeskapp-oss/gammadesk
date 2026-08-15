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
 * Driven by Vercel Cron — see `vercel.json`, which fires this four times an
 * evening. Each firing takes the next shard from a stored cursor, so the four
 * together cover the whole S&P 500 once a day without any single run fetching
 * more than about 125 symbols.
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
