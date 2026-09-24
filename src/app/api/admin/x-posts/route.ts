import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { postingEnabled, postingEnabledDiagnostic, runSlot } from '@/lib/x/run';
import { readLog, readPause, storeStatus } from '@/lib/x/store';
import { readBrief, readClosingBrief } from '@/lib/x/brief';
import { readHealthHistory } from '@/lib/health/store';
import { todaysImages } from '@/lib/x/imageStore';
import { marketToday } from '@/lib/time';
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
  { kind: 'morning', key: 'morning', label: 'Morning post (8:30 CT)' },
  { kind: 'intraday', key: 'intraday-preview', label: 'Intraday update (every 30–45 min, 9:00–2:45 CT)' },
  { kind: 'closing', key: 'closing', label: 'Closing post (3:15 CT)' },
  { kind: 'earnings', key: 'earnings', label: 'Earnings today (7:30 CT, trading days)' },
  { kind: 'weekly', key: 'weekly', label: 'Weekly recap (Sun 5:00 CT)' },
];

/**
 * Compose the (dry-run) previews of each slot's next post. These each fetch
 * live market data, so they are fault-isolated and time-bounded — a slow or
 * broken upstream returns a visible note, never a 500.
 */
async function buildPreviews() {
  const PREVIEW_BUDGET_MS = 8_000;
  return Promise.all(
    PREVIEW_SLOTS.map(async (slot) => {
      try {
        const outcome = await Promise.race([
          runSlot(slot, { dry: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('preview timed out')), PREVIEW_BUDGET_MS),
          ),
        ]);
        return {
          slot: slot.kind,
          label: slot.label,
          text: outcome.text ?? null,
          length: outcome.length ?? null,
          asOfLabel: outcome.asOfLabel ?? null,
          checks: outcome.checks ?? [],
          reason: outcome.reason ?? null,
          situation: outcome.situation ?? null,
        };
      } catch (error) {
        return {
          slot: slot.kind,
          label: slot.label,
          text: null,
          length: null,
          asOfLabel: null,
          checks: [],
          reason: `Preview unavailable: ${error instanceof Error ? error.message : String(error)}`,
          situation: null,
        };
      }
    }),
  );
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  /*
   * The previews fetch six live market snapshots, which is far too slow to gate
   * the console (and the console — status, pause state, Resume switch, log — is
   * exactly what the owner needs when posting has broken). So `?previews=1`
   * returns ONLY the previews; the default response returns everything else,
   * fast, from stored data alone. The client renders the console immediately
   * and loads the previews after.
   */
  if (new URL(request.url).searchParams.get('previews') === '1') {
    return NextResponse.json({ previews: await buildPreviews() }, { headers: NO_STORE });
  }

  const [log, pause, brief, closingBrief, images, health] = await Promise.all([
    readLog().catch(() => []),
    readPause().catch(() => ({ paused: false })),
    readBrief().catch(() => null),
    readClosingBrief().catch(() => null),
    todaysImages(marketToday()).catch(() => ({ morning: null, closing: null })),
    readHealthHistory().catch(() => []),
  ]);

  return NextResponse.json(
    {
      postingEnabled: postingEnabled(),
      postingEnv: postingEnabledDiagnostic(),
      // Which build is serving — Vercel injects the commit SHA per deployment.
      // Lets the owner confirm a redeploy actually landed.
      deployedCommit: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null,
      pause,
      store: storeStatus(),
      brief,
      closingBrief,
      images,
      recent: log.slice(0, 40),
      // Previews are loaded separately by the client (see the `?previews=1`
      // branch above) so a slow upstream can't delay the console.
      previews: [],
      health: health.slice(0, 30),
    },
    { headers: NO_STORE },
  );
}
