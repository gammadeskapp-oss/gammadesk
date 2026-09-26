import 'server-only';

import { createJsonStore } from './jsonStore';
import type { PositioningData } from './types';

/**
 * A cross-instance cache of the configured symbol's full positioning payload —
 * the entire dataset /decision renders (levels, exposure by strike, meta), not
 * just the poster's summary snapshot.
 *
 * ## Why, on top of the in-process cache
 *
 * `positioning.getPositioning` already memoises within a process for
 * `GAMMADESK_CACHE_SECONDS`. That does nothing for a *cold* serverless instance,
 * whose memory starts empty — so the first /decision hit on a fresh lambda paid
 * the full chain fetch + IV-surface parse, which ran tens of seconds and made
 * the page hang. This Blob copy survives cold starts: the refresher cron writes
 * it every few minutes, and a cold instance reads it in well under a second
 * instead of recomputing. The in-process cache still sits in front, so a warm
 * instance never touches Blob.
 */
interface CachedPositioning {
  data: PositioningData;
  /** When the payload was computed — mirrors the in-process TTL for freshness. */
  builtAtIso: string;
}

const store = createJsonStore<CachedPositioning | null>(
  'gammadesk/positioning-spy.json',
  () => null,
  (raw) => {
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as CachedPositioning).builtAtIso === 'string' &&
      (raw as CachedPositioning).data &&
      typeof (raw as CachedPositioning).data === 'object'
    ) {
      return raw as CachedPositioning;
    }
    return null;
  },
);

/** Persist the freshly computed positioning payload. Best-effort. */
export async function writeCachedPositioning(data: PositioningData): Promise<void> {
  await store.write({ data, builtAtIso: new Date().toISOString() }).catch(() => {});
}

/** The raw cached payload with the time it was built, or null when never written. */
export async function readCachedPositioning(): Promise<{ data: PositioningData; builtAtIso: string } | null> {
  return store.read().catch(() => null);
}
