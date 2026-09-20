import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { marketSessionRules } from '@/lib/events';
import { chicagoNow, duePulseSlot } from '@/lib/x/schedule';
import { runSlot } from '@/lib/x/run';
import { storeStatus } from '@/lib/x/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The hourly market-pulse post to X, 9:30 AM–2:30 PM CT on trading days. New
 * cron — see `vercel.json`.
 *
 * The cron fires every hour across a UTC window wide enough to cover the Central
 * session in both summer and winter; `duePulseSlot` reads the Chicago clock and
 * returns the slot only when the hour is inside 9–14 CT. The slot key carries
 * the Chicago hour, so the six firings a day are six distinct once-a-day rows.
 *
 * `?dry=1` composes and self-checks without posting. `?force=1` posts for the
 * current Chicago hour regardless of the once-a-day ledger.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const force = params.get('force') === '1';

  const now = new Date();
  let slot = duePulseSlot(now, marketSessionRules());

  // A forced run outside the window still needs a key; derive it from the
  // current Chicago hour so a manual test does not collide with a real slot.
  if (!slot && force) {
    const hh = String(chicagoNow(now).hour).padStart(2, '0');
    slot = { kind: 'pulse', key: `pulse-${hh}`, label: `Market pulse (${hh}:30 CT)` };
  }

  if (!slot) {
    return NextResponse.json({ status: 'skipped', reason: 'Outside the 9:30–2:30 CT pulse window, or not a trading day.' });
  }

  const outcome = await runSlot(slot, { dry, force, now });
  return NextResponse.json({ ...outcome, store: storeStatus() });
}
