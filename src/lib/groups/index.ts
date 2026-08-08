import 'server-only';

import { cached } from '../cache';
import { createJsonStore, storeStatus } from '../jsonStore';
import { computeGroupsSnapshot } from './compute';
import type { GroupsSnapshot } from './types';

export { storeStatus } from '../jsonStore';

/**
 * Group scores are computed once and served to everyone from the stored copy.
 *
 * Twenty-odd symbols is far too many to fan out on a page view, so a cron job
 * refreshes this daily and every request reads the result. If no stored
 * snapshot exists yet — a fresh deploy, or before the first cron run — the
 * first request computes one, behind the single-flight cache, and persists it.
 * That is a once-per-day cost at worst, not per view.
 */

const store = createJsonStore<GroupsSnapshot | null>(
  'gammadesk/groups.json',
  () => null,
  (raw) => {
    if (
      raw && typeof raw === 'object' &&
      Array.isArray((raw as GroupsSnapshot).groups) &&
      (raw as GroupsSnapshot).internals
    ) {
      return raw as GroupsSnapshot;
    }
    return null;
  },
);

/** How old a stored snapshot may be before it is recomputed on read. */
const MAX_AGE_MS = 20 * 60 * 60 * 1000;
/** In-process reuse window, so a burst of views shares one store read. */
const MEMO_SECONDS = 900;

function ageMs(snapshot: GroupsSnapshot): number {
  const at = Date.parse(snapshot.computedAt);
  return Number.isFinite(at) ? Date.now() - at : Infinity;
}

/** Recompute and persist. Used by the cron job and by the lazy path. */
export async function refreshGroupsSnapshot(): Promise<GroupsSnapshot> {
  const snapshot = await computeGroupsSnapshot();
  try {
    await store.write(snapshot);
  } catch {
    // A storage failure must not lose the computed result — serve it anyway
    // and let the next run try again.
  }
  return snapshot;
}

/**
 * The snapshot every page reads. Never fans out per view.
 */
export function getGroupsSnapshot(): Promise<GroupsSnapshot | null> {
  return cached('groups:snapshot', MEMO_SECONDS, async () => {
    const stored = await store.read().catch(() => null);
    if (stored && ageMs(stored) < MAX_AGE_MS) return stored;

    try {
      return await refreshGroupsSnapshot();
    } catch {
      // Stale beats empty: an old snapshot is still informative, and it is
      // labelled with its own timestamp on the page.
      return stored;
    }
  });
}

/**
 * The stored snapshot exactly as written, with no age filter and no
 * computation. Used by the health check to answer "did the job actually run?".
 */
export function peekStoredGroups(): Promise<GroupsSnapshot | null> {
  return store.read().catch(() => null);
}

/**
 * Read-only peek used by the forecast for its breadth input.
 *
 * Deliberately never triggers a computation — the forecast should not be able
 * to set off a twenty-symbol fan-out. If no snapshot exists yet, breadth is
 * simply reported as unavailable.
 */
export async function peekBreadth(): Promise<GroupsSnapshot | null> {
  try {
    const stored = await store.read();
    return stored && ageMs(stored) < MAX_AGE_MS * 3 ? stored : null;
  } catch {
    return null;
  }
}

export function groupsStoreStatus() {
  return storeStatus();
}
