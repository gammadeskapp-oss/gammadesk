import { NextResponse, type NextRequest } from 'next/server';
import { unsubscribeByToken } from '@/lib/email/subscribe';
import { operatorDetail } from '@/lib/errorText';

/**
 * One-click unsubscribe.
 *
 * GET is the human clicking the link in an email; POST is the RFC 8058
 * List-Unsubscribe-Post one-click request some mail clients send. Both verify
 * the signed (never-expiring) token and mark the Resend contact unsubscribed.
 * The link must keep working forever, by law, so the token has no TTL.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(token: string | null): Promise<{ status: 'ok' | 'invalid' | 'error' }> {
  try {
    const result = await unsubscribeByToken(token);
    return { status: result.ok ? 'ok' : 'invalid' };
  } catch (error) {
    console.error('[email/unsubscribe] failed:', operatorDetail(error));
    return { status: 'error' };
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { status } = await handle(url.searchParams.get('token'));
  return NextResponse.redirect(`${url.origin}/email/unsubscribed?status=${status}`);
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  // One-click clients may send the token in the query or the form body.
  let token = url.searchParams.get('token');
  if (!token) {
    try {
      const form = await request.formData();
      const value = form.get('token');
      if (typeof value === 'string') token = value;
    } catch {
      // no body — fall through with whatever we have
    }
  }
  const { status } = await handle(token);
  return NextResponse.json({ status }, { status: status === 'ok' ? 200 : 400 });
}
