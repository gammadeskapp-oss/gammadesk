/**
 * The breadth arithmetic, with nothing that touches the network.
 *
 * Deliberately free of `server-only` and of any import that reaches upstream,
 * so `scripts/verify-breadth.mjs` can import it and check the counting against
 * hand-built fixtures. Every fetching module in this folder calls into here
 * rather than counting for itself.
 */

import type { BreadthCounts, BreadthSample, EqualWeightSpread } from './types';

/**
 * Percentage points the equal-weight spread must clear before it is called
 * anything at all.
 *
 * RSP and SPY have different fees, different rebalancing and slightly
 * different trading behaviour, so they do not print identical day changes even
 * when every stock moves alike. Below this band the honest word is "even".
 */
export const FLAT_BAND_PCT = 0.15;

/** Minutes of look-back behind the "higher than they were" reading. */
export const GREEN_LOOKBACK_MINUTES = 15;

/** One symbol, reduced to what the counting needs. */
export interface SymbolSession {
  symbol: string;
  /** Latest traded price. */
  last: number;
  /** Yesterday's closing price. */
  previousClose: number;
  /**
   * Prices earlier in the session, oldest first, latest last.
   *
   * Only the Yahoo fallback carries these; the Tradier quote path is a
   * snapshot and supplies none. Everything that needs them treats an empty
   * array as "not measurable" rather than substituting the latest price.
   */
  closes?: number[];
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/**
 * Share of a session's own prices the latest one sits above.
 *
 * NOT a volume-weighted average price, and not named as though it were. A
 * volume-weighted average needs the volume traded at each price, and neither
 * batch source carries it — Tradier quotes are a snapshot with no VWAP field,
 * and Yahoo's spark payload has no volume at all. Fetching it per symbol would
 * be five hundred requests a minute, which is the cost this whole design
 * exists to avoid.
 *
 * The plain mean of the session's prices answers a similar question — is this
 * company above where it has spent the day — without pretending to be the
 * other measure.
 */
function aboveSessionAverage(closes: number[], last: number): boolean {
  const mean = closes.reduce((sum, c) => sum + c, 0) / closes.length;
  return last > mean;
}

/**
 * Count a universe into one sample.
 *
 * @param priorPrices  What each symbol was trading at roughly fifteen minutes
 *   ago, from this project's own stored snapshots. Symbols absent from it are
 *   left out of that percentage rather than counted as unchanged.
 *
 * Symbols with no usable price are not counted at all — they are absent from
 * `measured`, so they cannot quietly land on either side of the ledger, and
 * every percentage is taken over the symbols that actually answered.
 */
export function computeSample(
  sessions: Iterable<SymbolSession>,
  at: Date,
  etClock: string,
  priorPrices: Map<string, number> = new Map(),
): BreadthSample {
  const counts: BreadthCounts = {
    measured: 0,
    advancers: 0,
    decliners: 0,
    unchanged: 0,
  };

  let aboveAverage = 0;
  let averageMeasured = 0;
  let green = 0;
  let greenMeasured = 0;

  for (const session of sessions) {
    const { last, previousClose } = session;
    if (!(last > 0) || !(previousClose > 0)) continue;

    counts.measured += 1;
    if (last > previousClose) counts.advancers += 1;
    else if (last < previousClose) counts.decliners += 1;
    else counts.unchanged += 1;

    if (session.closes && session.closes.length > 0) {
      averageMeasured += 1;
      if (aboveSessionAverage(session.closes, last)) aboveAverage += 1;
    }

    const prior = priorPrices.get(session.symbol);
    if (typeof prior === 'number' && prior > 0) {
      greenMeasured += 1;
      if (last > prior) green += 1;
    }
  }

  return {
    at: at.toISOString(),
    etClock,
    pctAbovePriorClose: pct(counts.advancers, counts.measured),
    pctAboveSessionAverage:
      averageMeasured === 0 ? null : pct(aboveAverage, averageMeasured),
    pctGreen15m: greenMeasured === 0 ? null : pct(green, greenMeasured),
    counts,
  };
}

/**
 * Classify the equal-weight spread.
 *
 * Deliberately not called bullish or bearish. The same positive spread appears
 * on a strong day where a few giants lead and on a weak day where the giants
 * are the ones falling; the word describes participation only.
 */
export function spreadShape(spreadPct: number): EqualWeightSpread['shape'] {
  if (Math.abs(spreadPct) < FLAT_BAND_PCT) return 'even';
  return spreadPct < 0 ? 'broad' : 'narrow';
}

/** Where a headline breadth percentage sits against the colour bands. */
export type BreadthBand = 'high' | 'middle' | 'low';

/** Green above 60, neutral 40-60, red below 40. */
export function breadthBand(pctAbove: number): BreadthBand {
  if (pctAbove > 60) return 'high';
  if (pctAbove < 40) return 'low';
  return 'middle';
}
