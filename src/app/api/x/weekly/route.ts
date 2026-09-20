import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { dueWeeklySlot } from '@/lib/x/schedule';
import { runSlot } from '@/lib/x/run';
import { storeStatus } from '@/lib/x/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The Sunday 5:00 PM CT weekly-recap post to X. New cron — see `vercel.json`.
 *
 * Leads with the Cowork "Week in review" brief; there is no live fallback, so
 * if this week's brief has not arrived the run skips and logs it. Registered at
 * both candidate UTC times so the 5:00 PM Central slot is covered in summer and
 * winter; `dueWeeklySlot` reads the Chicago clock and only the Sunday 5:xx
 * firing posts.
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
    ? { kind: 'weekly' as const, key: 'weekly', label: 'Weekly recap (Sun 5:00 CT)' }
    : dueWeeklySlot(now);

  if (!slot) {
    return NextResponse.json({ status: 'skipped', reason: 'Not the Sunday 5:00 PM CT weekly slot.' });
  }

  const outcome = await runSlot(slot, { dry, force, now });
  return NextResponse.json({ ...outcome, store: storeStatus() });
}
