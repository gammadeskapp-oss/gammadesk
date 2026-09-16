import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_S, checkPassword, createSession } from '@/lib/tos/auth';
import { isRateLimited, recordFailure, clearFailures } from '@/lib/tos/rateLimit';

/**
 * Unlock the TOS Trend tab.
 *
 * The password is compared on the server, in constant time, against
 * TOS_TAB_PASSWORD — never in the browser. Failed attempts are rate-limited to
 * five per fifteen minutes per IP; a correct password clears that count. On
 * success a signed, httpOnly, SameSite=Strict cookie is set for thirty days —
 * `secure` in production, but not on plain-http localhost, where a Secure
 * cookie would be silently dropped and the unlock would appear to fail.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Secure only over HTTPS. Local `next dev` is plain http, where Secure kills the cookie. */
const SECURE_COOKIE = process.env.NODE_ENV === 'production';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Pull the password out of the request body, tolerating both JSON and
 * form-encoded bodies and never throwing on an empty or malformed one.
 *
 * Reading the raw text once and parsing it ourselves avoids `request.json()`
 * throwing (which silently became an empty password) when a proxy, a form post
 * or a different content-type is in play.
 */
async function readSubmittedPassword(request: NextRequest): Promise<string> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return '';
  }
  if (!raw) return '';

  // JSON body: { "password": "..." }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const value = (parsed as { password?: unknown }).password;
      if (typeof value === 'string') return value;
    }
  } catch {
    // Not JSON — fall through to form parsing.
  }

  // Form-encoded body: password=...
  try {
    const value = new URLSearchParams(raw).get('password');
    if (value != null) return value;
  } catch {
    // Neither shape — treated as empty below.
  }

  return '';
}

export async function POST(request: NextRequest) {
  // Log configuration presence only — never the values — so a "wrong password"
  // that is really a missing env var is diagnosable from the server logs.
  // Bracket access so the value is read at request time, not inlined at build.
  console.log(
    '[tos-unlock] TOS_TAB_PASSWORD defined:',
    Boolean(process.env['TOS_TAB_PASSWORD']),
    '| TOS_COOKIE_SECRET defined:',
    Boolean(process.env['TOS_COOKIE_SECRET']),
    '| runtime:',
    process.env['NEXT_RUNTIME'] ?? 'nodejs',
  );

  const key = `tos-unlock:${clientIp(request)}`;

  // Peek — do not count this request yet. Only wrong guesses count, below.
  const limited = isRateLimited(key);
  if (limited.blocked) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limited.retryAfterS) } },
    );
  }

  const password = await readSubmittedPassword(request);

  if (!checkPassword(password)) {
    recordFailure(key);
    return NextResponse.json({ error: 'Wrong password.' }, { status: 401, headers: NO_STORE });
  }

  // Correct: clear any accumulated failures so a good password is never blocked.
  clearFailures(key);

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
    secure: SECURE_COOKIE,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
