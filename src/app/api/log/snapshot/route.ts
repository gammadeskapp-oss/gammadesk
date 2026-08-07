import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { recordSnapshot } from '@/lib/log/record';
import { storeStatus } from '@/lib/log/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Records the day's levels. Driven by Vercel Cron — see `vercel.json`.
 * `?force=1` bypasses the market-hours and holiday guards, for testing.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    const result = await recordSnapshot({ force });
    return NextResponse.json({ ...result, store: storeStatus() });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Snapshot failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
