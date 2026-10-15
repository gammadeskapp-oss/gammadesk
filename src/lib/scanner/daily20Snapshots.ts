import 'server-only';

import { createJsonStore } from '../jsonStore';
import { diffDaily20, type ChangeLine } from './daily20Diff';
import type { Daily20 } from './daily20';

/**
 * Persistence for the "What Changed Today" feed.
 *
 * The Daily 20 is derived from the once-a-day scan, so "the previous run" is the
 * previous session's Daily 20. This stores one compact snapshot per session and
 * diffs today's against the most recent earlier one. The first session ever
 * stored has nothing to compare against, so the feed is empty — which is the
 * honest state, not a bug.
 *
 * The snapshot is written lazily on the first page render of a new session
 * (guarded so later views of the same day do not rewrite it), the same pattern
 * the flow and sectors stores use for their lazy fallbacks. A render-time write
 * is acceptable here because it happens at most once per session and the
 * payload is small; a failed write simply means the feed has no prior next time
 * rather than an error now.
 */

const KEEP = 10;

interface StoredSnapshot {
  /** `YYYY-MM-DD` New York session this Daily 20 describes. */
  date: string;
  daily20: Daily20;
}

interface Daily20History {
  snapshots: StoredSnapshot[];
}

const store = createJsonStore<Daily20History>(
  'gammadesk/daily20-snapshots.json',
  () => ({ snapshots: [] }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return { snapshots: [] };
    const h = raw as Daily20History;
    return Array.isArray(h.snapshots) ? h : { snapshots: [] };
  },
);

/** The most recent stored snapshot strictly before `date`, or null. */
function priorBefore(history: Daily20History, date: string): Daily20 | null {
  const prior = history.snapshots
    .filter((s) => s.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return prior?.daily20 ?? null;
}

/**
 * Diff today's Daily 20 against the previous session's, and record today's
 * snapshot if this session has not been stored yet.
 *
 * Returns the change lines (empty on the very first session). The record step
 * is best-effort: a store that cannot be written leaves the feed without a
 * prior next session rather than failing this render.
 */
export async function recordAndDiffDaily20(
  today: Daily20,
  date: string,
): Promise<ChangeLine[]> {
  const history = await store.read().catch(() => ({ snapshots: [] as StoredSnapshot[] }));
  const changes = diffDaily20(priorBefore(history, date), today);

  const alreadyStored = history.snapshots.some((s) => s.date === date);
  if (!alreadyStored) {
    const next: Daily20History = {
      snapshots: [{ date, daily20: today }, ...history.snapshots]
        .filter((s, i, arr) => arr.findIndex((o) => o.date === s.date) === i)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, KEEP),
    };
    try {
      await store.write(next);
    } catch {
      // Best-effort — see the note on this module.
    }
  }

  return changes;
}

/** Read-only peek for diagnostics; never writes. */
export function peekDaily20Snapshots(): Promise<Daily20History> {
  return store.read().catch(() => ({ snapshots: [] }));
}
