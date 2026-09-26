import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { getForecast } from '@/lib/forecast';
import { getPositioning } from '@/lib/positioning';
import { computeDeskSnapshotForCache } from '@/lib/x/deskData';
import { writeCachedDeskSnapshot } from '@/lib/x/snapshotStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// This is the ONE route that fetches and parses the full option chain and
// resolves the IV surface. It is deliberately isolated so the cost lives in a
// single place with the platform's maximum budget; the poster tick and the
// pages then read the small snapshot it writes. See `lib/x/snapshotStore.ts`.
export const maxDuration = 300;

/**
 * The snapshot refresher.
 *
 * A Vercel cron wakes this every 5 minutes across the trading day (see
 * `vercel.json`). Each wake computes the desk snapshot once — the expensive
 * chain fetch + IV-surface parse — and writes the small result to Blob for the
 * poster tick to read. Nothing here posts; it only refreshes the cache.
 *
 * `?dry=1` computes without writing, for a manual check.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const now = new Date();

  try {
    // Keep the /decision Blob caches warm. These are the non-force paths: each
    // refreshes and rewrites its Blob only when the stored copy has aged past its
    // own TTL, so Polygon (15-min delayed) is not refetched every 5 minutes and
    // the forecast cone does not re-simulate needlessly. The desk snapshot below
    // then reuses the same in-process positioning and overlays a fresh spot.
    if (!dry) {
      await getPositioning();
      await getForecast().catch(() => null);
    }
    const cached = await computeDeskSnapshotForCache(now);
    if (!dry) await writeCachedDeskSnapshot(cached);
    return NextResponse.json({
      status: dry ? 'computed (not written)' : 'written',
      source: cached.source,
      spot: cached.snapshot.spot,
      dataIso: cached.snapshot.dataIso,
      builtAtIso: cached.builtAtIso,
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
