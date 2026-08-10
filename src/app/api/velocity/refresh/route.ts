import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { refreshVelocity, storeStatus } from '@/lib/velocity';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Captures today's per-strike gamma and diffs it against the last stored day.
 * Driven by Vercel Cron — see `vercel.json`.
 *
 * Safe to run repeatedly: a day already captured is a no-op.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  try {
    const result = await refreshVelocity();
    return NextResponse.json({
      status: 'captured',
      currentDate: result.currentDate,
      previousDate: result.previousDate,
      snapshotsStored: result.snapshotsStored,
      strikesTracked: result.totalCompared,
      changesFlagged: result.rows.length,
      notes: result.notes,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Velocity capture failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
