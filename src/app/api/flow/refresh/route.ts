import { NextResponse } from 'next/server';
import { refreshFlowSnapshot, storeStatus } from '@/lib/flow';
import { denyUnauthorisedCron } from '@/lib/log/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Rescans every tracked symbol's option chain for unusual activity.
 * Driven by Vercel Cron — see `vercel.json`.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  try {
    const snapshot = await refreshFlowSnapshot();
    return NextResponse.json({
      status: 'refreshed',
      computedAt: snapshot.computedAt,
      scanned: snapshot.scanned,
      flagged: snapshot.rows.length,
      notes: snapshot.notes,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Flow refresh failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
