import 'server-only';

import { NextResponse } from 'next/server';

/**
 * Guard for the cron endpoints.
 *
 * These endpoints write to persistent storage and spend upstream API calls, so
 * they must not be openly callable. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` when that variable is set on the
 * project.
 *
 * If `CRON_SECRET` is missing the endpoints refuse to run rather than
 * defaulting to open — an unauthenticated write endpoint is worse than a
 * feature that has not been switched on yet.
 */
export function denyUnauthorisedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      {
        error: 'CRON_SECRET is not configured.',
        detail:
          'Set CRON_SECRET in the project environment. Vercel Cron sends it as a bearer token; without it these endpoints stay disabled.',
      },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  // Fall back to a query token so the jobs can be triggered by hand.
  const queryToken = new URL(request.url).searchParams.get('token') ?? '';

  if (!timingSafeEqual(provided, secret) && !timingSafeEqual(queryToken, secret)) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  return null;
}

/** Constant-time compare, so a wrong token cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
