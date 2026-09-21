import { NextResponse, type NextRequest } from 'next/server';
import { emailEnabled } from '@/lib/email/config';
import { requestSubscription } from '@/lib/email/subscribe';
import { operatorDetail } from '@/lib/errorText';

/**
 * Public signup endpoint for the email brief (step one of double opt-in).
 *
 * It creates the pending Resend contact and sends the confirmation email. The
 * response is deliberately uniform — the same "check your inbox" whether or not
 * the address was already known — so it cannot be used to enumerate who is
 * subscribed. A small per-process budget blunts a signup flood; the real limit
 * is Resend's own.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const budgetKey = Symbol.for('gammadesk.email.subscribeBudget');
type GlobalWithBudget = typeof globalThis & { [budgetKey]?: number[] };

function claimBudget(): boolean {
  const g = globalThis as GlobalWithBudget;
  const hits = (g[budgetKey] ??= []);
  const now = Date.now();
  while (hits.length > 0 && now - hits[0] >= WINDOW_MS) hits.shift();
  if (hits.length >= MAX_PER_WINDOW) return false;
  hits.push(now);
  return true;
}

export async function POST(request: NextRequest) {
  if (!emailEnabled()) {
    return NextResponse.json(
      { ok: false, message: 'Email signup isn’t switched on yet.' },
      { status: 503 },
    );
  }

  if (!claimBudget()) {
    return NextResponse.json(
      { ok: false, message: 'Too many signups right now — try again in a minute.' },
      { status: 429 },
    );
  }

  let email = '';
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === 'string' ? body.email : '';
  } catch {
    return NextResponse.json({ ok: false, message: 'Send an email address.' }, { status: 400 });
  }

  try {
    const result = await requestSubscription(email);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error('[email/subscribe] failed:', operatorDetail(error));
    return NextResponse.json(
      { ok: false, message: 'Something went wrong sending the confirmation. Try again shortly.' },
      { status: 502 },
    );
  }
}
