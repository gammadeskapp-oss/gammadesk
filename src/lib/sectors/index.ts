import 'server-only';

import { cached } from '../cache';
import { createJsonStore } from '../jsonStore';
import { computeSectorsSnapshot } from './compute';
import type { SectorsSnapshot } from './types';

export { storeStatus } from '../jsonStore';
export { SECTOR_THRESHOLDS } from './compute';
export type { SectorMomentum, SectorsSnapshot } from './types';

/**
 * Computed once a day and served to everyone from storage.
 *
 * Forty-odd bar fetches is far too much for a page view. The lazy fallback
 * exists only so a fresh deploy is not blank before the first cron fires.
 *
 * Unlike the other daily jobs, nothing is lost if a run is missed: the history
 * is derived from the bars each time rather than accumulated, so the next run
 * produces the full window regardless.
 */

const store = createJsonStore<SectorsSnapshot | null>(
  'gammadesk/sectors.json',
  () => null,
  (raw) =>
    raw && typeof raw === 'object' && Array.isArray((raw as SectorsSnapshot).sectors)
      ? (raw as SectorsSnapshot)
      : null,
);

const MAX_AGE_MS = 20 * 60 * 60 * 1000;
const MEMO_SECONDS = 900;

function ageMs(snapshot: SectorsSnapshot): number {
  const at = Date.parse(snapshot.computedAt);
  return Number.isFinite(at) ? Date.now() - at : Infinity;
}

export async function refreshSectorsSnapshot(): Promise<SectorsSnapshot> {
  const snapshot = await computeSectorsSnapshot();
  try {
    await store.write(snapshot);
  } catch {
    // Serve the computed result even if it could not be persisted.
  }
  return snapshot;
}

/** The stored copy exactly as written, with no age filter and no compute. */
export function peekStoredSectors(): Promise<SectorsSnapshot | null> {
  return store.read().catch(() => null);
}

export function getSectorsSnapshot(): Promise<SectorsSnapshot | null> {
  return cached('sectors:snapshot', MEMO_SECONDS, async () => {
    const stored = await store.read().catch(() => null);
    if (stored && ageMs(stored) < MAX_AGE_MS) return stored;

    try {
      return await refreshSectorsSnapshot();
    } catch {
      // Stale beats empty; the page carries its own timestamp.
      return stored;
    }
  });
}

/**
 * Split into the two sides the page shows.
 *
 * Sorted on the five-session change: rotation is a multi-day idea, and the
 * one-day number flips too often to rank anything usefully. Sectors with no
 * five-day reading yet fall to the bottom of whichever side they land on.
 */
/**
 * Below this the change is not worth calling a direction.
 *
 * Also guards the display: the deltas are averages of ninths, so an unchanged
 * sector lands on values like -1.8e-15 rather than a clean zero. Without a
 * floor that sector is filed under "fading fastest" and rendered as "-0.0",
 * which looks like a bug because it is one.
 */
const FLAT_EPSILON = 0.05;

export function splitByMomentum(snapshot: SectorsSnapshot) {
  const ranked = snapshot.sectors.filter(
    (s) => s.delta5 !== null && Math.abs(s.delta5) >= FLAT_EPSILON,
  );

  const accelerating = ranked
    .filter((s) => (s.delta5 as number) > 0)
    .sort((a, b) => (b.delta5 as number) - (a.delta5 as number));

  const decelerating = ranked
    .filter((s) => (s.delta5 as number) < 0)
    .sort((a, b) => (a.delta5 as number) - (b.delta5 as number));

  const flat = snapshot.sectors.filter(
    (s) => s.delta5 === null || Math.abs(s.delta5) < FLAT_EPSILON,
  );

  return { accelerating, decelerating, flat };
}
