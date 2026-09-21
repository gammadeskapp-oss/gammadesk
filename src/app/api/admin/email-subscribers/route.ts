import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { emailDiagnostic, emailEnabled } from '@/lib/email/config';
import { listContacts } from '@/lib/email/resend';
import { operatorDetail } from '@/lib/errorText';

/**
 * Owner-only view of the email audience for /admin/email-subscribers.
 *
 * Guarded by the same signed session cookie as the other owner tooling — no
 * valid cookie, no data, ever. The subscriber list lives in Resend; this reads
 * it live rather than keeping any copy. Marked no-store and noindex.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  if (!emailEnabled()) {
    return NextResponse.json(
      { configured: false, missing: emailDiagnostic(), contacts: [], counts: { total: 0, confirmed: 0, pending: 0 } },
      { headers: NO_STORE },
    );
  }

  try {
    const contacts = await listContacts();
    const confirmed = contacts.filter((c) => !c.unsubscribed).length;
    return NextResponse.json(
      {
        configured: true,
        counts: { total: contacts.length, confirmed, pending: contacts.length - confirmed },
        contacts: contacts
          .map((c) => ({ email: c.email, status: c.unsubscribed ? 'pending/unsubscribed' : 'subscribed', createdAt: c.created_at ?? null }))
          .sort((a, b) => (a.email < b.email ? -1 : 1)),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error('[admin/email-subscribers] failed:', operatorDetail(error));
    return NextResponse.json(
      { configured: true, error: 'Could not read the audience from Resend.' },
      { status: 502, headers: NO_STORE },
    );
  }
}
