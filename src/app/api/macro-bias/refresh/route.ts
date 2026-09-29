import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { refreshMacroBias, storeStatus } from '@/lib/macroBias';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The daily Macro Bias refresh — see `vercel.json`.
 *
 * Pulls the three FRED series, scores them, and stores the record the home
 * page's box reads. Runs once on a weekday morning; FRED revises these series
 * slowly, so nothing is gained by running it more often.
 *
 * A FRED failure is reported as `nothing-stored`, not a 500: the previous
 * record stays in place and the box keeps showing yesterday's numbers.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const result = await refreshMacroBias();

  return NextResponse.json({
    status: result.stored ? 'stored' : 'nothing-stored',
    score: result.bias?.score ?? null,
    label: result.bias?.label ?? null,
    error: result.error ?? null,
    store: storeStatus(),
  });
}
