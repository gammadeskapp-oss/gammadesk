import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { postingEnabled, runSlot } from '@/lib/x/run';
import { readLog, readPause, storeStatus } from '@/lib/x/store';
import { readBrief } from '@/lib/x/brief';
import type { PostSlot } from '@/lib/x/types';

/**
 * Owner-only data for the /admin/x-posts page: recent post log, the pause
 * state, the env kill-switch state, and a live preview of each slot's next
 * post (composed and self-checked, never sent).
 *
 * Guarded by the same signed session cookie as the TOS tab — no valid cookie,
 * no data, ever. Marked no-store and noindex.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

const PREVIEW_SLOTS: PostSlot[] = [
  { kind: 'morning', key: 'morning', label: 'Morning snapshot (~8:25 CT)' },
  { kind: 'gamma', key: 'gamma', label: 'SPY gamma levels (8:30 CT)' },
  { kind: 'pulse', key: 'pulse-preview', label: 'Market pulse (hourly 9:30–2:30 CT)' },
  { kind: 'closing', key: 'closing', label: 'Closing snapshot' },
];

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  const [log, pause, brief] = await Promise.all([
    readLog().catch(() => []),
    readPause().catch(() => ({ paused: false })),
    readBrief().catch(() => null),
  ]);

  // Previews are dry runs — compose and self-check, never post or log.
  const previews = await Promise.all(
    PREVIEW_SLOTS.map(async (slot) => {
      const outcome = await runSlot(slot, { dry: true });
      return {
        slot: slot.kind,
        label: slot.label,
        text: outcome.text ?? null,
        length: outcome.length ?? null,
        asOfLabel: outcome.asOfLabel ?? null,
        checks: outcome.checks ?? [],
        reason: outcome.reason ?? null,
      };
    }),
  );

  return NextResponse.json(
    {
      postingEnabled: postingEnabled(),
      pause,
      store: storeStatus(),
      brief,
      recent: log.slice(0, 40),
      previews,
    },
    { headers: NO_STORE },
  );
}
