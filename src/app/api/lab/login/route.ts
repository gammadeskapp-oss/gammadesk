import { NextResponse, type NextRequest } from 'next/server';
import { LAB_SESSION_COOKIE, checkLabPassword, createLabSession } from '@/lib/lab/auth';
import { clearFailures, isRateLimited, recordFailure } from '@/lib/tos/rateLimit';

/**
 * `/lab` login. A plain form POST, so it works without client JS, answered
 * with a 303 back to `/lab` (pass) or `/lab/login?e=…` (fail).
 *
 * ## Rate limit
 *
 * Five wrong guesses per IP per 15 minutes, and thirty across all IPs, counted
 * in this instance's memory (the same limiter the TOS lock uses). On a
 * serverless host that is per-instance, so the scrypt cost of every check is
 * the floor underneath it. Only wrong guesses count; a correct password clears
 * its IP's tally.
 *
 * ## The cookie
 *
 * httpOnly, Secure, SameSite=Strict, path `/` (so `/api/lab` sees it too) and
 * no Max-Age: it ends with the browser session — there is no "remember me" —
 * and the token inside expires on the server after twelve hours regardless.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 30;
const GLOBAL_KEY = 'lab-login:*';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' };

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function back(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), { status: 303, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const ipKey = `lab-login:${clientIp(request)}`;
  if (isRateLimited(ipKey, PER_IP_LIMIT).blocked || isRateLimited(GLOBAL_KEY, GLOBAL_LIMIT).blocked) {
    return back(request, '/lab/login?e=rate');
  }

  let password = '';
  try {
    const form = await request.formData();
    const value = form.get('password');
    if (typeof value === 'string') password = value;
  } catch {
    // Not a form body; treated as an empty password below.
  }

  if (!checkLabPassword(password)) {
    recordFailure(ipKey);
    recordFailure(GLOBAL_KEY);
    return back(request, '/lab/login?e=bad');
  }
  clearFailures(ipKey);

  const token = createLabSession();
  if (!token) return back(request, '/lab/login?e=config');

  const res = back(request, '/lab');
  res.cookies.set({
    name: LAB_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
  return res;
}
