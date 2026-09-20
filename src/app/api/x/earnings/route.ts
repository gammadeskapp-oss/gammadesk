import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { marketSessionRules } from '@/lib/events';
import { dueEarningsSlot } from '@/lib/x/schedule';
import { runSlot } from '@/lib/x/run';
import { storeStatus } from '@/lib/x/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The 7:30 AM CT earnings-day post to X. New cron — see `vercel.json`.
 *
 * Posts only when a well-known large company reports today (names come from the
 * morning brief's earnings list, filtered to megacaps); otherwise the build
 * skips silently. Registered at both candidate UTC times so the 7:30 Central
 * slot is covered in summer and winter; `dueEarningsSlot` reads the Chicago
 * clock and only the intended firing runs. The once-a-day ledger keeps it to at
 * most one earnings post per day.
 *
 * `?dry=1` composes and self-checks without posting. `?force=1` runs regardless
 * of the clock and re-posts a slot already sent.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  const now = new Date();
  const slot = force
    ? { kind: 'earnings' as const, key: 'earnings', label: 'Earnings today (7:30 CT)' }
    : dueEarningsSlot(now, marketSessionRules());

  if (!slot) {
    return NextResponse.json({ status: 'skipped', reason: 'Not the 7:30 AM CT earnings slot on a trading day.' });
  }

  const outcome = await runSlot(slot, { dry, force, now });
  return NextResponse.json({ ...outcome, store: storeStatus() });
}
