import 'server-only';

import { createJsonStore, storeStatus } from '../../jsonStore';
import { EVENT_SOURCES, type EventSource } from './types';
import {
  allFeedEvents,
  emptyFeedDoc,
  emptySource,
  FEED_SCHEMA,
  foldRefresh,
  type FeedDoc,
  type SourceResult,
} from './fold';

export { storeStatus, allFeedEvents };
export type { FeedDoc, FeedSourceState, SourceResult } from './fold';

/**
 * The fetched-events store — the Fed Board + Treasury pull, kept in Blob beside
 * the other snapshots. The document shape and the per-source fold are pure and
 * live in `fold.ts`; this file is only the IO. Events are held grouped by
 * source so a failing feed keeps its last good data (see `fold.ts`).
 */

const store = createJsonStore<FeedDoc>(
  'gammadesk/fed-events.json',
  emptyFeedDoc,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as FeedDoc;
    if (doc.schema !== FEED_SCHEMA || typeof doc.bySource !== 'object' || !doc.bySource) return null;
    // Fill in any source added since this document was written, so an older
    // document does not crash a reader expecting every source.
    for (const s of EVENT_SOURCES) doc.bySource[s] ??= emptySource();
    return doc;
  },
);

export async function readFeedDoc(): Promise<FeedDoc> {
  return store.read().catch(() => emptyFeedDoc());
}

/**
 * Fold this run's per-source results into the stored document (keep-old on
 * failure) and write it. Returns the written document.
 */
export async function applyRefresh(
  results: Partial<Record<EventSource, SourceResult>>,
  now: Date = new Date(),
): Promise<FeedDoc> {
  return store.update((current) => foldRefresh(current, results, now));
}
