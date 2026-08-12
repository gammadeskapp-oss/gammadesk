import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { refreshSectorsSnapshot, storeStatus } from '@/lib/sectors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Recomputes sector momentum and stores it. Driven by Vercel Cron.
 *
 * Roughly forty daily-bar fetches, then the nine signals recomputed ten times
 * per symbol over slices already in memory — cheap upstream, a little CPU.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  try {
    const snapshot = await refreshSectorsSnapshot();

    return NextResponse.json({
      status: 'refreshed',
      asOfDate: snapshot.asOfDate,
      computedAt: snapshot.computedAt,
      sectors: snapshot.sectors.length,
      sessions: snapshot.sessions,
      flagged: snapshot.sectors.filter((s) => s.flag).length,
      notes: snapshot.notes,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Sector refresh failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
