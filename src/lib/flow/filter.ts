import { marketToday } from '../time';
import type { FlowRow, FlowSnapshot, FlowSymbolSummary } from './types';

/**
 * Expiry filtering for the flow screen.
 *
 * The scan is stored once a day and read for as long as it stands, so by the
 * next session its front-week contracts have expired. Those rows are history:
 * whatever traded there can no longer trade again, and showing them as
 * "unusual activity" points a beginner at a contract that does not exist.
 *
 * Kept out of the capture on purpose. What counts as expired depends on the
 * day the page is *read*, not the day the chain was scanned, so filtering at
 * storage time would bake in the wrong answer and throw away rows a chosen
 * date range might legitimately want back.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` from the query string, or null.
 *
 * Round-tripped through Date so that `2026-02-31` is rejected rather than
 * silently compared as a string that sorts after every real February date.
 */
export function parseDateParam(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value || !ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

export interface FlowFilterInput {
  from?: string | null;
  to?: string | null;
}

export interface FilteredFlow {
  rows: FlowRow[];
  /** Chain totals, with `flagged` recounted against the visible rows. */
  symbols: FlowSymbolSummary[];
  /** Rows the filter removed. */
  hidden: number;
  /** How many of those had already expired. */
  expiredHidden: number;
  /** The range actually applied, after validation. */
  from: string | null;
  to: string | null;
  /** True when no valid range was given and the live-only default ran. */
  usingDefault: boolean;
  /** New York date the filter measured against. */
  today: string;
}

export function filterFlow(
  snapshot: FlowSnapshot,
  input: FlowFilterInput = {},
): FilteredFlow {
  const today = marketToday();
  const from = parseDateParam(input.from);
  const to = parseDateParam(input.to);
  const usingDefault = from === null && to === null;

  const keep = (row: FlowRow): boolean => {
    // An explicit range wins outright, including one that reaches backwards —
    // asking to see last week's expiries is a legitimate thing to ask for.
    if (!usingDefault) {
      if (from !== null && row.expiration < from) return false;
      if (to !== null && row.expiration > to) return false;
      return true;
    }
    // Contracts expiring today are still trading, so the test is strict.
    return row.expiration >= today;
  };

  const rows = snapshot.rows.filter(keep);

  const flaggedBySymbol = new Map<string, number>();
  for (const row of rows) {
    flaggedBySymbol.set(row.symbol, (flaggedBySymbol.get(row.symbol) ?? 0) + 1);
  }

  const hiddenRows = snapshot.rows.length - rows.length;

  return {
    rows,
    // Chain volume and open interest are whole-chain figures and unaffected by
    // an expiry filter; only the flagged count describes the rows above, so
    // only that is recounted.
    symbols: snapshot.symbols.map((s) => ({
      ...s,
      flagged: flaggedBySymbol.get(s.symbol) ?? 0,
    })),
    hidden: hiddenRows,
    expiredHidden: snapshot.rows.filter(
      (r) => !keep(r) && r.expiration < today,
    ).length,
    from,
    to,
    usingDefault,
    today,
  };
}
