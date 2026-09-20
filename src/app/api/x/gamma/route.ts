import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { marketSessionRules } from '@/lib/events';
import { dueGammaSlot } from '@/lib/x/schedule';
import { runSlot } from '@/lib/x/run';
import { storeStatus } from '@/lib/x/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The 8:30 AM CT SPY daily gamma-levels post to X. New cron — see `vercel.json`.
 *
 * Registered at both candidate UTC times so the 8:30 Central slot is covered in
 * summer and winter; the route reads the actual Chicago clock via `dueGammaSlot`
 * and only the intended firing posts. The other firing sees the wrong hour and
 * returns without spending anything.
 *
 * `?dry=1` composes and self-checks without posting — used to review wording.
 * `?force=1` runs regardless of the clock and re-posts a slot already sent.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  const now = new Date();
  const slot = force
    ? { kind: 'gamma' as const, key: 'gamma', label: 'SPY daily gamma levels (8:30 CT)' }
    : dueGammaSlot(now, marketSessionRules());

  if (!slot) {
    return NextResponse.json({ status: 'skipped', reason: 'Not the 8:30 CT gamma slot on a trading day.' });
  }

  const outcome = await runSlot(slot, { dry, force, now });
  return NextResponse.json({ ...outcome, store: storeStatus() });
}
