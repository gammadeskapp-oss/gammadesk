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
 * Vercel's Hobby plan rejects any cron *expression* that would run more than
 * once a day, and fails the whole deployment when it sees one — the concise
 * four-times-an-hour form took the entire build down with it. Four entries
 * pointing at this same route are four once-daily expressions, which is
 * allowed, and the cron-count limit is 100 on every plan so the extra entries
 * cost nothing.
 *
 * They are spaced two hours apart rather than fifteen minutes because Hobby
 * only guarantees the *hour* of a cron, firing anywhere within it. Runs
 * fifteen minutes apart on paper could therefore land in any order or land
 * together, and two concurrent runs would read the same cursor, refresh the
 * same shard twice and skip another. Two hours of separation makes that
 * overlap impossible. The later three run on days 2-6 because they fall after
 * midnight UTC — they are still the same weekday *evening* in New York.
 *
 * On Pro this could go back to one entry at any frequency; nothing about the
 * code depends on the split.
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
