import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { readAllScans, storeStatus } from '@/lib/news/store';

/**
 * Owner-only data for /admin/news: every stored scan, newest first, with the
 * full ranked list per day so the owner can see what got filtered out. Guarded
 * by the same signed session cookie as the TOS tab and the X console — no valid
 * cookie, no data. Marked no-store and noindex.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  const scans = await readAllScans().catch(() => []);
  return NextResponse.json(
    {
      store: storeStatus(),
      deployedCommit: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null,
      scans,
    },
    { headers: NO_STORE },
  );
}
