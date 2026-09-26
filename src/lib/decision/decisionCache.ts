import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { DecisionResult } from './types';

/**
 * Cross-instance cache of the configured symbol's full decision result — the
 * primary payload /decision renders. `getDecision` memoises in-process, but a
 * cold lambda starts empty and pays two chain fetches + the level/exposure work.
 * The refresher cron writes this Blob; a cold instance reads it in well under a
 * second. Only the configured symbol is cached (the one the cron pre-computes);
 * an on-demand ticker still builds on request.
 */
interface CachedDecision {
  data: DecisionResult;
  builtAtIso: string;
}

const store = createJsonStore<CachedDecision | null>(
  'gammadesk/decision-spy.json',
  () => null,
  (raw) => {
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as CachedDecision).builtAtIso === 'string' &&
      (raw as CachedDecision).data &&
      typeof (raw as CachedDecision).data === 'object'
    ) {
      return raw as CachedDecision;
    }
    return null;
  },
);

/** Persist the freshly built decision result. Best-effort. */
export async function writeCachedDecision(data: DecisionResult): Promise<void> {
  await store.write({ data, builtAtIso: new Date().toISOString() }).catch(() => {});
}

/** The raw cached decision with the time it was built, or null when never written. */
export async function readCachedDecision(): Promise<{ data: DecisionResult; builtAtIso: string } | null> {
  return store.read().catch(() => null);
}
