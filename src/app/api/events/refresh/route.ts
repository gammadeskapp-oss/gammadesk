import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { refreshFedEvents, seedingAllowed } from '@/lib/events/feed/refresh';
import { storeStatus } from '@/lib/events/feed/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The Fed/Treasury events refresh — see `vercel.json`.
 *
 * Fetches the Fed Board calendar and TreasuryDirect auctions for the next seven
 * days, de-duplicates, and stores them for every surface that reads the
 * calendar (merged with the hand-maintained CPI/jobs entries). Runs at 6:00 AM
 * CT and re-checks at 12:00 PM CT.
 *
 * A source that fails keeps its last good events and records the error rather
 * than blanking the calendar (see `feed/store.ts`), so this returns the health
 * — not a 500 — on a feed outage. `?seed=1` loads the fixtures instead of the
 * network and is honoured ONLY outside production; the cron never passes it.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const seed = new URL(request.url).searchParams.get('seed') === '1';
  const result = await refreshFedEvents({ seed });

  return NextResponse.json({
    ...result,
    seedingAllowed: seedingAllowed(),
    store: storeStatus(),
  });
}
