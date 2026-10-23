import { NextResponse, type NextRequest } from 'next/server';
import { LAB_SESSION_COOKIE } from '@/lib/lab/auth';

/** Ends the `/lab` session: clears the cookie and returns to the login page. */
export const dynamic = 'force-dynamic';

export function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL('/lab/login', request.url), {
    status: 303,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
  res.cookies.set({
    name: LAB_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}
