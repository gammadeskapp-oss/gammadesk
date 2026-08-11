import 'server-only';

import { getPositioningForSymbol } from '../positioning';
import { runScan, scanSymbols } from '../scanUniverse';
import { marketNow } from '../time';
import type { StrikeGamma, VelocitySnapshot } from './types';

/**
 * Captures per-strike dollar gamma across the tracked symbols.
 *
 * Each symbol needs its whole option chain, which is megabytes, so this runs in
 * small waves and only ever from the daily job or a once-a-day lazy trigger —
 * never per page view.
 */

/** Strikes below this absolute gamma are noise and not worth storing. */
const MIN_ABS_GEX = 250_000;

/** Expirations captured per symbol. The near book is where positioning moves. */
const EXPIRATIONS = 5;

export async function captureSnapshot(): Promise<VelocitySnapshot> {
  const symbols = scanSymbols();

  const strikes: StrikeGamma[] = [];
  const spots: Record<string, number> = {};
  const failures: string[] = [];
  const quoteDates: string[] = [];

  // Waves, pacing and the time budget are shared with /flow — see
  // `scanUniverse`, which is also the file to edit to change the list.
  const { results, covered, skipped } = await runScan(symbols, async (symbol) => {
    try {
      return { symbol, data: await getPositioningForSymbol(symbol, EXPIRATIONS) };
    } catch {
      return { symbol, data: null };
    }
  });

  for (const { symbol, data } of results) {
    if (!data) {
      failures.push(symbol);
      continue;
    }

    spots[symbol] = data.spot;
    quoteDates.push(marketNow(new Date(data.meta.quoteDateIso)).date);

    data.expirationMeta.forEach((expiry, column) => {
      for (const row of data.rows) {
        const cell = row.cells[column];
        if (!cell) continue;
        if (Math.abs(cell.gex) < MIN_ABS_GEX) continue;
        strikes.push({ t: symbol, e: expiry.date, k: row.strike, g: cell.gex });
      }
    });
  }

  /*
   * The snapshot's date is the chain's, taken as the most common quote date
   * across symbols rather than the wall clock — see the note on the type.
   */
  const tally = new Map<string, number>();
  for (const d of quoteDates) tally.set(d, (tally.get(d) ?? 0) + 1);
  const date =
    [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? marketNow().date;

  return {
    date,
    capturedAt: new Date().toISOString(),
    spots,
    strikes,
    // Only what this run actually read. The diff intersects these across two
    // days, so a symbol the budget never reached must not appear here — it
    // would otherwise read as every one of its strikes going to zero.
    symbols: covered.filter((s) => !failures.includes(s)),
    failures,
    universe: symbols.length,
    skipped,
  };
}
