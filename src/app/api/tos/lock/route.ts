import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/tos/auth';

/**
 * Lock the tab again by clearing the session cookie. No body, no auth needed —
 * the worst a stray call can do is log the caller out of their own tab.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    // Match the unlock cookie's attributes so the browser overwrites/expires it.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}
