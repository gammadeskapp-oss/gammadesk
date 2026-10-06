import 'server-only';

import { createJsonStore } from '../jsonStore';
import { marketToday } from '../time';
import { lookupEarnings, type EarningsLookup } from './earnings';
import { scanCandidates } from './run';
import type { EarningsInfo } from './types';

/**
 * Earnings dates as their own step, run before the scan.
 *
 * ## Why this is a separate job now
 *
 * The scan used to look earnings up inline, batched fifty symbols at a time —
 * and because the whole index is eleven sequential round trips to a sometimes-
 * slow fundamentals endpoint, it could only afford the top 150 names before the
 * run risked the platform's function ceiling and stored nothing. Everything
 * below 150 carried an `unknown` date for no better reason than the clock.
 *
 * Pulled out into its own 9:00 ET step, it has a whole function invocation to
 * itself, so it looks up **every** ranked name and writes the result here. The
 * scan then reads this store instead of fetching, which costs it nothing and
 * lets it finish in seconds. If this step has not run — a cold morning, a
 * failed fetch — the scan falls back to its own inline lookup of the top names,
 * so nothing regresses.
 *
 * The stored map is the full `EarningsInfo` per symbol, so the scan's exclusion
 * rule reads the same `state`/`daysAway` it always has. See `EarningsInfo` —
 * unknown is never "no earnings soon".
 */

interface StoredEarnings {
  /** New York date this lookup belongs to. */
  date: string;
  fetchedAt: string;
  /** One line naming where the dates came from, for the UI and the admin table. */
  source: string;
  /** Symbol → reading. */
  bySymbol: Record<string, EarningsInfo>;
  /** How many names got a real date, for the health check and the admin table. */
  dated: number;
  /** How many names were looked up in all. */
  requested: number;
}

const earningsStore = createJsonStore<StoredEarnings>(
  'gammadesk/scanner-earnings.json',
  () => ({ date: '', fetchedAt: '', source: '', bySymbol: {}, dated: 0, requested: 0 }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as StoredEarnings;
    return doc.bySymbol && typeof doc.bySymbol === 'object' ? doc : null;
  },
);

export interface EarningsStepOutcome {
  date: string;
  requested: number;
  dated: number;
  source: string;
}

/**
 * Look up earnings for every ranked name and store the result. Never throws:
 * `lookupEarnings` degrades every failure to `unknown` rather than rejecting,
 * so the worst case here is a stored map of unknowns with the reason recorded.
 */
export async function runEarningsStep(): Promise<EarningsStepOutcome> {
  const date = marketToday();
  const { rows } = await scanCandidates();
  const symbols = rows.map((r) => r.symbol);

  const lookup = await lookupEarnings(symbols, date);
  const bySymbol: Record<string, EarningsInfo> = {};
  let dated = 0;
  for (const symbol of symbols) {
    const info = lookup.bySymbol.get(symbol) ?? {
      state: 'unknown' as const,
      dateIso: null,
      daysAway: null,
      source: 'not looked up',
    };
    bySymbol[symbol] = info;
    if (info.state === 'known') dated += 1;
  }

  const stored: StoredEarnings = {
    date,
    fetchedAt: new Date().toISOString(),
    source: lookup.source,
    bySymbol,
    dated,
    requested: symbols.length,
  };

  try {
    await earningsStore.write(stored);
  } catch {
    // The scan falls back to its own inline lookup when this is missing, so a
    // failed write degrades to the old behaviour rather than losing the dates.
  }

  return { date, requested: symbols.length, dated, source: lookup.source };
}

/**
 * Today's stored earnings as a lookup, or null when there is nothing for today.
 *
 * Date-checked for the same reason the gamma store is: a map from a previous
 * session is the wrong answer, not a degraded one, and the scan reading it
 * would exclude names on last week's calendar.
 */
export async function readTodaysEarnings(): Promise<EarningsLookup | null> {
  const doc = await earningsStore.read().catch(() => null);
  if (!doc || !doc.date || doc.date !== marketToday()) return null;
  const bySymbol = new Map<string, EarningsInfo>(Object.entries(doc.bySymbol));
  return { bySymbol, source: doc.source };
}

/** The stored document whatever its date, for the admin health table. */
export function peekEarnings(): Promise<StoredEarnings | null> {
  return earningsStore.read().catch(() => null);
}

export { earningsStore };
export type { StoredEarnings };
