import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { marketSessionRules } from '@/lib/events';
import { dueClosingSlot } from '@/lib/x/schedule';
import { runSlot } from '@/lib/x/run';
import { storeStatus } from '@/lib/x/store';
import { cleanupOldImages } from '@/lib/x/imageStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The 3:15 PM CT closing post to X — the fixed template built from the same
 * /decision SPY data (close, day change, flip, range, top/worst name, top
 * story). New cron — see `vercel.json`.
 *
 * Registered at both candidate UTC times so the 3:15 Central slot is covered in
 * summer and winter; `dueClosingSlot` reads the Chicago clock and only the
 * intended firing posts.
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
    ? { kind: 'closing' as const, key: 'closing', label: 'Closing post (3:15 CT)' }
    : dueClosingSlot(now, marketSessionRules());

  if (!slot) {
    return NextResponse.json({ status: 'skipped', reason: 'Not the 3:15 CT closing slot on a trading day.' });
  }

  const outcome = await runSlot(slot, { dry, force, now });

  // Daily cleanup rides on the once-a-day closing firing: retire posted poster
  // images older than 7 days. Never touches an unposted image. Non-fatal, and
  // skipped on a dry run so a preview changes nothing.
  const cleanup = dry ? null : await cleanupOldImages(now).catch(() => null);

  return NextResponse.json({ ...outcome, cleanup, store: storeStatus() });
}
