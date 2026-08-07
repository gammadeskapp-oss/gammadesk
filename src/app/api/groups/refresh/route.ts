import { NextResponse } from 'next/server';
import { refreshGroupsSnapshot, storeStatus } from '@/lib/groups';
import { denyUnauthorisedCron } from '@/lib/log/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Recomputes every group score and the breadth strip. Driven by Vercel Cron —
 * see `vercel.json`.
 *
 * This is the path that keeps page views cheap: everyone reads the stored
 * result rather than triggering their own fan-out.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  try {
    const snapshot = await refreshGroupsSnapshot();
    return NextResponse.json({
      status: 'refreshed',
      asOfDate: snapshot.asOfDate,
      computedAt: snapshot.computedAt,
      universe: snapshot.internals.universe,
      groups: snapshot.groups.map((g) => ({
        id: g.id,
        label: g.label,
        bullishTickers: g.bullishTickers,
        totalTickers: g.totalTickers,
        bullishSignals: g.bullishSignals,
        totalSignals: g.totalSignals,
      })),
      notes: snapshot.notes,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Group refresh failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
