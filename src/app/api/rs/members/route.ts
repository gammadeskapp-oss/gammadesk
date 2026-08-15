import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { storeStatus } from '@/lib/jsonStore';
import { refreshMembership } from '@/lib/rs/membership';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Refetches the S&P 500 constituent list and stores it.
 *
 * Weekly, from Vercel Cron. The index reconstitutes quarterly with occasional
 * one-off replacements, so a list at most seven days old is never meaningfully
 * wrong — and a fetch that comes back implausible is rejected rather than
 * stored, leaving the previous list in place. See `lib/rs/membership.ts`.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  try {
    const membership = await refreshMembership();
    return NextResponse.json({
      status: 'refreshed',
      source: membership.source,
      count: membership.members.length,
      fetchedAt: membership.fetchedAt,
      added: membership.added,
      removed: membership.removed,
      notes: membership.notes,
      store: storeStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Membership refresh failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
