import { NextResponse, type NextRequest } from 'next/server';
import { confirmSubscription } from '@/lib/email/subscribe';
import { operatorDetail } from '@/lib/errorText';

/**
 * The double opt-in confirmation link's target.
 *
 * Verifies the signed token, flips the Resend contact to subscribed, and sends
 * the reader to a friendly page. The token carries the email, so nothing had to
 * be stored between signup and this click.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token');
  const origin = new URL(request.url).origin;

  try {
    const result = await confirmSubscription(token);
    const status = result.ok ? 'ok' : 'invalid';
    return NextResponse.redirect(`${origin}/email/confirmed?status=${status}`);
  } catch (error) {
    console.error('[email/confirm] failed:', operatorDetail(error));
    return NextResponse.redirect(`${origin}/email/confirmed?status=error`);
  }
}
