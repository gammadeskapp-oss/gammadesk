import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { pollTrendInbox, hasCredentials } from '@/lib/tos/service';
import { markChecked } from '@/lib/tos/store';

/**
 * The five-minute TOS Scanner poll (see vercel.json).
 *
 * Cron-protected exactly like the other write jobs here — `Authorization:
 * Bearer $CRON_SECRET`, or `?token=` for a manual trigger. Records the run in
 * the store either way, so the tab can show "last checked" and go stale when
 * this stops firing.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  if (!hasCredentials()) {
    return NextResponse.json(
      { ok: false, error: 'GMAIL_USER / GMAIL_APP_PASSWORD not set.' },
      { status: 503 },
    );
  }

  try {
    const result = await pollTrendInbox();
    await markChecked(null);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markChecked(message).catch(() => {});
    // This route is cron-authenticated, so the message is safe to return here.
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
