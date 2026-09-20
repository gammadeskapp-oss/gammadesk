import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { readPause, setPause } from '@/lib/x/store';

/**
 * Owner-only pause switch for the X poster.
 *
 * POST `{ "paused": true|false }` flips the runtime pause (stored in Blob),
 * which every slot checks before sending. This is the button on
 * /admin/x-posts; it is separate from the `X_POSTING_ENABLED` env kill switch,
 * which is the deploy-level master off. Guarded by the signed session cookie.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

async function readPaused(request: NextRequest): Promise<boolean | null> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { paused?: unknown };
    if (typeof parsed.paused === 'boolean') return parsed.paused;
  } catch {
    // Not JSON — fall through.
  }
  return null;
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  const paused = await readPaused(request);
  if (paused === null) {
    return NextResponse.json(
      { error: 'Body must be { "paused": true } or { "paused": false }.' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const next = paused
      ? await setPause({ paused: true, by: 'owner', reason: 'Paused from the admin page.', at: new Date().toISOString() })
      : await setPause({ paused: false, by: 'owner', reason: 'Resumed from the admin page.', at: new Date().toISOString() });
    return NextResponse.json({ ok: true, pause: next }, { headers: NO_STORE });
  } catch {
    // A read after a failed write lets the caller see the true state.
    const current = await readPause().catch(() => ({ paused }));
    return NextResponse.json(
      { error: 'Could not update the pause state.', pause: current },
      { status: 500, headers: NO_STORE },
    );
  }
}
