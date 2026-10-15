import 'server-only';

import { createJsonStore } from '../jsonStore';
import { diffDaily20, type ChangeLine } from './daily20Diff';
import type { Daily20, Daily20Entry } from './daily20';
import type { Direction } from './directionScore';
import type { SetupState } from './daily20';

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

// The full snapshot store only feeds the one-session diff, so it needs just the
// previous session plus today.
const KEEP = 2;

// The listings store is the scorecard's raw material: one compact row per name
// per session, kept long enough to mature a 20-session forward return many
// times over.
const LISTINGS_CAP = 2000;

/** One Daily 20 listing, flattened for the scorecard. No prices — the loader adds those. */
export interface Daily20ListingRow {
  date: string;
  symbol: string;
  direction: Direction;
  setup: SetupState;
  regime: 'positive' | 'negative' | null;
  extended: boolean;
  /** Not in the previous session's Daily 20 on this side. */
  newEntry: boolean;
  /** Sector name at listing time, so the by-sector breakdown is not empty. Null when unmapped. */
  sector: string | null;
}

interface Daily20Listings {
  rows: Daily20ListingRow[];
}

const listingsStore = createJsonStore<Daily20Listings>(
  'gammadesk/daily20-listings.json',
  () => ({ rows: [] }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return { rows: [] };
    const d = raw as Daily20Listings;
    return Array.isArray(d.rows) ? d : { rows: [] };
  },
);

function listingRows(
  today: Daily20,
  prior: Daily20 | null,
  date: string,
  sectorBySymbol: Map<string, string>,
): Daily20ListingRow[] {
  const priorBull = new Set((prior?.bullish ?? []).map((e) => e.symbol));
  const priorBear = new Set((prior?.bearish ?? []).map((e) => e.symbol));
  const row = (e: Daily20Entry, newEntry: boolean): Daily20ListingRow => ({
    date,
    symbol: e.symbol,
    direction: e.direction,
    setup: e.setup,
    regime: e.row.regime,
    extended: e.gate.observations.extended,
    newEntry,
    sector: sectorBySymbol.get(e.symbol) ?? null,
  });
  return [
    ...today.bullish.map((e) => row(e, !priorBull.has(e.symbol))),
    ...today.bearish.map((e) => row(e, !priorBear.has(e.symbol))),
  ];
}

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
  /** Symbol → sector name, so each listing row carries its sector for the scorecard. */
  sectorBySymbol: Map<string, string> = new Map(),
): Promise<ChangeLine[]> {
  const history = await store.read().catch(() => ({ snapshots: [] as StoredSnapshot[] }));
  const prior = priorBefore(history, date);
  const changes = diffDaily20(prior, today);

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

    // Append this session's listing rows for the scorecard.
    try {
      const current = await listingsStore.read().catch(() => ({ rows: [] as Daily20ListingRow[] }));
      const kept = current.rows.filter((r) => r.date !== date);
      const rows = [...listingRows(today, prior, date, sectorBySymbol), ...kept].slice(0, LISTINGS_CAP);
      await listingsStore.write({ rows });
    } catch {
      // Best-effort — the scorecard simply has fewer sessions next time.
    }
  }

  return changes;
}

/** All stored listing rows for the scorecard loader. */
export function peekDaily20Listings(): Promise<Daily20Listings> {
  return listingsStore.read().catch(() => ({ rows: [] }));
}

/** Read-only peek for diagnostics; never writes. */
export function peekDaily20Snapshots(): Promise<Daily20History> {
  return store.read().catch(() => ({ snapshots: [] }));
}
