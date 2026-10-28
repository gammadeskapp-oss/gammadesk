import 'server-only';

import { cached } from '../cache';
import { currentMarketStatus } from '../events';
import { createJsonStore } from '../jsonStore';
import { dropExpired } from '../time';
import { computeFlowSnapshot } from './compute';
import { FLOW_SCHEMA, type FlowSnapshot } from './types';

export { storeStatus } from '../jsonStore';

/**
 * Flow is computed once a day and served to everyone from the stored copy.
 *
 * Each scan reads every chain in `lib/scanUniverse.ts` — eighty of them,
 * several megabytes apiece — so this must never run on a page view. The lazy
 * fallback exists only so a fresh deploy is not blank until the first cron
 * fires, and it inherits the same time budget as the job.
 */

const store = createJsonStore<FlowSnapshot | null>(
  'gammadesk/flow.json',
  () => null,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const snapshot = raw as FlowSnapshot;
    // Exact-match the schema: a snapshot written before `premium` existed
    // would otherwise validate and then filter as if nothing qualified.
    if (snapshot.schema !== FLOW_SCHEMA) return null;
    return Array.isArray(snapshot.rows) ? snapshot : null;
  },
);

const MAX_AGE_MS = 20 * 60 * 60 * 1000;

/**
 * The snapshot with every expired contract removed, applied on every read.
 *
 * The scan runs after the close and is served for most of the next day, so a
 * row that was live when it was written can be dead when it is read. Filtering
 * here rather than in each page is what keeps Home, /dashboard, /flow and /lab
 * from ever disagreeing about it.
 */
function withoutExpired(snapshot: FlowSnapshot): FlowSnapshot {
  return { ...snapshot, rows: dropExpired(snapshot.rows) };
}
const MEMO_SECONDS = 900;

function ageMs(snapshot: FlowSnapshot): number {
  const at = Date.parse(snapshot.computedAt);
  return Number.isFinite(at) ? Date.now() - at : Infinity;
}

/**
 * The stored snapshot exactly as written, with no age filter and no rescan.
 * Used by the health check to answer "did the job actually run?".
 */
export async function peekStoredFlow(): Promise<FlowSnapshot | null> {
  const stored = await store.read().catch(() => null);
  return stored && withoutExpired(stored);
}

export async function refreshFlowSnapshot(): Promise<FlowSnapshot> {
  const snapshot = await computeFlowSnapshot();
  try {
    await store.write(snapshot);
  } catch {
    // Serve the computed result even if it could not be persisted.
  }
  return snapshot;
}

export async function getFlowSnapshot(): Promise<FlowSnapshot | null> {
  const snapshot = await cached('flow:snapshot', MEMO_SECONDS, async () => {
    const stored = await store.read().catch(() => null);
    // While the market is closed the last snapshot is the whole answer — flow is
    // computed once a day and nothing new prints overnight or at the weekend — so
    // serve it however old rather than recomputing the chain on a cold request.
    if (stored) {
      const status = currentMarketStatus();
      const marketClosed = status.phase === 'after-close' || status.phase === 'closed-day';
      if (marketClosed || ageMs(stored) < MAX_AGE_MS) return stored;
    }

    try {
      return await refreshFlowSnapshot();
    } catch {
      // Stale beats empty; the page shows its own timestamp.
      return stored;
    }
  });
  return snapshot && withoutExpired(snapshot);
}
