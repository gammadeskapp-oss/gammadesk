import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { marketToday } from '@/lib/time';
import { pauseToday, readPause, resume, setPause } from '@/lib/x/store';

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

type PauseAction = { paused: false } | { paused: true; scope: 'today' | 'until-fixed' };

async function readAction(request: NextRequest): Promise<PauseAction | null> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { paused?: unknown; scope?: unknown };
    if (parsed.paused === false) return { paused: false };
    if (parsed.paused === true) {
      const scope = parsed.scope === 'today' ? 'today' : 'until-fixed';
      return { paused: true, scope };
    }
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

  const action = await readAction(request);
  if (action === null) {
    return NextResponse.json(
      { error: 'Body must be { "paused": false }, { "paused": true } or { "paused": true, "scope": "today" }.' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    let next;
    if (!action.paused) {
      next = await resume('Resumed from the admin page.');
    } else if (action.scope === 'today') {
      next = await pauseToday(marketToday());
    } else {
      next = await setPause({ paused: true, by: 'owner', scope: 'until-fixed', reason: 'Paused from the admin page.', at: new Date().toISOString() });
    }
    return NextResponse.json({ ok: true, pause: next }, { headers: NO_STORE });
  } catch {
    const current = await readPause().catch(() => ({ paused: action.paused }));
    return NextResponse.json(
      { error: 'Could not update the pause state.', pause: current },
      { status: 500, headers: NO_STORE },
    );
  }
}
