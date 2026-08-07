import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { settleOutstanding } from '@/lib/log/record';
import { storeStatus } from '@/lib/log/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Settles every finished session that has not been judged yet. Driven by
 * Vercel Cron — see `vercel.json`.
 *
 * Safe to run repeatedly: already-settled days are skipped, and days whose bar
 * is not published yet are simply retried next time.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  try {
    const result = await settleOutstanding();
    return NextResponse.json({ ...result, store: storeStatus() });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Settlement failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
