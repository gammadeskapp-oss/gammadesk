import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/tos/auth';
import { fedEventsHealth } from '@/lib/events/feed/refresh';
import { EVENT_SOURCE_LABEL } from '@/lib/events/feed/types';
import { todaysMergedEvents } from '@/lib/events/merged';
import { storeStatus } from '@/lib/events/feed/store';

/**
 * Owner-only health data for /admin/events.
 *
 * Reads stored documents only — the fetched-events store and the merged
 * today's list — so it never triggers a fetch. Guarded by the same signed
 * session cookie as the rest of /admin. Shows, per source, when it last
 * fetched cleanly, how many events are held, and the most recent failure.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(request: NextRequest) {
  if (!verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Locked.' }, { status: 401, headers: NO_STORE });
  }

  const [health, today] = await Promise.all([
    fedEventsHealth(),
    todaysMergedEvents().catch(() => []),
  ]);

  return NextResponse.json(
    {
      ...health,
      sourceLabels: EVENT_SOURCE_LABEL,
      today,
      store: storeStatus(),
    },
    { headers: NO_STORE },
  );
}
