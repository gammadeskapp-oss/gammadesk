import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { marketSessionRules } from '@/lib/events';
import { dueMorningSlot } from '@/lib/x/schedule';
import { runSlot } from '@/lib/x/run';
import { storeStatus } from '@/lib/x/store';

/**
 * The 8:30 AM CT morning post to X — the fixed template built from the same
 * /decision SPY data (spot, mood, walls, flip, strong/weak names). Its own cron
 * — see `vercel.json`.
 *
 * Registered at both candidate UTC times so the 8:30 Central slot is covered in
 * summer and winter; `dueMorningSlot` reads the actual Chicago clock and only
 * the intended firing posts — the other sees the wrong hour and returns without
 * spending anything.
 *
 * `?dry=1` composes and self-checks without posting. `?force=1` runs regardless
 * of the clock and re-posts a slot already sent.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  const now = new Date();
  const slot = force
    ? { kind: 'morning' as const, key: 'morning', label: 'Morning post (8:30 CT)' }
    : dueMorningSlot(now, marketSessionRules());

  if (!slot) {
    return NextResponse.json({ status: 'skipped', reason: 'Not the 8:30 CT morning slot on a trading day.' });
  }

  const outcome = await runSlot(slot, { dry, force, now });
  return NextResponse.json({ ...outcome, store: storeStatus() });
}
