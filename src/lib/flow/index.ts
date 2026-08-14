import 'server-only';

import { cached } from '../cache';
import { createJsonStore } from '../jsonStore';
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
const MEMO_SECONDS = 900;

function ageMs(snapshot: FlowSnapshot): number {
  const at = Date.parse(snapshot.computedAt);
  return Number.isFinite(at) ? Date.now() - at : Infinity;
}

/**
 * The stored snapshot exactly as written, with no age filter and no rescan.
 * Used by the health check to answer "did the job actually run?".
 */
export function peekStoredFlow(): Promise<FlowSnapshot | null> {
  return store.read().catch(() => null);
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

export function getFlowSnapshot(): Promise<FlowSnapshot | null> {
  return cached('flow:snapshot', MEMO_SECONDS, async () => {
    const stored = await store.read().catch(() => null);
    if (stored && ageMs(stored) < MAX_AGE_MS) return stored;

    try {
      return await refreshFlowSnapshot();
    } catch {
      // Stale beats empty; the page shows its own timestamp.
      return stored;
    }
  });
}
