import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_S, checkPassword, createSession } from '@/lib/tos/auth';
import { rateLimit } from '@/lib/tos/rateLimit';

/**
 * Unlock the TOS Trend tab.
 *
 * The password is compared on the server, in constant time, against
 * TOS_TAB_PASSWORD — never in the browser. Attempts are rate-limited to five
 * per fifteen minutes per IP. On success a signed, httpOnly, secure,
 * SameSite=Strict cookie is set for thirty days.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function POST(request: NextRequest) {
  const decision = rateLimit(`tos-unlock:${clientIp(request)}`);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(decision.retryAfterS) } },
    );
  }

  let password = '';
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && typeof (body as { password?: unknown }).password === 'string') {
      password = (body as { password: string }).password;
    }
  } catch {
    // No/!JSON body — treated as an empty, wrong password below.
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'Wrong password.' }, { status: 401, headers: NO_STORE });
  }

  const token = createSession();
  if (!token) {
    // TOS_COOKIE_SECRET missing — refuse rather than issue an unsigned cookie.
    return NextResponse.json(
      { error: 'This tab is not configured for unlock.' },
      { status: 503, headers: NO_STORE },
    );
  }

  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
