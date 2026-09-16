import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { readTrend } from '@/lib/tos/store';

/**
 * The owner-only Trend list.
 *
 * Guarded by the signed session cookie set at unlock: no valid cookie, no data,
 * ever — 401 and nothing else. The response is deliberately thin (symbols,
 * per-symbol added times, the two timestamps, and a staleness boolean); the
 * stored `lastError` and the raw email content never leave the server. Marked
 * no-store and noindex so it is neither cached nor indexed.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

/** Older than this since the last successful check and the tab warns. */
const STALE_AFTER_MS = 15 * 60 * 1000;

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  try {
    const { symbols, addedAt, updatedAt, lastCheckedAt } = await readTrend();
    const isStale =
      !lastCheckedAt || Date.now() - new Date(lastCheckedAt).getTime() > STALE_AFTER_MS;
    return NextResponse.json(
      { symbols, addedAt, updatedAt, lastCheckedAt, isStale },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: 'Could not read the Trend list.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
