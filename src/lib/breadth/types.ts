/**
 * Shapes for the breadth meter.
 *
 * "Breadth" is the share of stocks taking part in a move. The index can rise
 * because five giant companies rose; breadth is how the other four hundred and
 * ninety-five did. Every field here is a count or a percentage of the S&P 500
 * constituents — never a judgement about where price goes next.
 */

/** Percentages are 0-100, already rounded for display by the reader, not here. */
export interface BreadthCounts {
  /** Constituents that produced a usable quote this refresh. */
  measured: number;
  /** Trading above yesterday's closing price. */
  advancers: number;
  /** Trading below it. */
  decliners: number;
  /** Exactly unchanged. Small, but it is not an advancer and not a decliner. */
  unchanged: number;
}

export interface BreadthSample {
  /** When this sample was taken, ISO-8601 UTC. */
  at: string;
  /** New York wall clock of the same instant, `HH:MM`, for the sparkline axis. */
  etClock: string;
  /** Share above yesterday's close, 0-100. The headline number. */
  pctAbovePriorClose: number;
  /**
   * Share above their own average price so far today, 0-100.
   *
   * NOT a volume-weighted average price. See `universe.ts` — the only working
   * multi-symbol endpoint returns no volume, so this is the plain average of
   * the session's prices instead. Named for what it is.
   */
  pctAboveSessionAverage: number | null;
  /** Share trading higher than they were fifteen minutes ago, 0-100. */
  pctGreen15m: number | null;
  counts: BreadthCounts;
}

/**
 * Method B — the two-symbol cross-check.
 *
 * RSP is the Invesco S&P 500 Equal Weight ETF. "Equal weight" means every one
 * of the five hundred companies counts the same, so RSP follows the average
 * company. SPY weights by company size, so it follows the giants. The gap
 * between them says which group is doing the moving.
 */
export interface EqualWeightSpread {
  /** RSP change since yesterday's close, in percent. */
  rspPct: number;
  /** SPY change since yesterday's close, in percent. */
  spyPct: number;
  /** `rspPct - spyPct`. Negative means the average company is doing worse. */
  spreadPct: number;
  /** Which reading the spread supports, once the flat band is applied. */
  shape: 'broad' | 'narrow' | 'even';
  at: string;
}

export interface BreadthReading {
  /** Method A. Null when the constituent sweep has not produced a sample yet. */
  computed: BreadthSample | null;
  /** Which price feed produced the latest sample. */
  source: 'tradier' | 'yahoo' | null;
  /** Method B. Null only when the two-symbol fetch itself failed. */
  spread: EqualWeightSpread | null;
  /** Earlier samples from today, oldest first, for the sparkline. */
  series: BreadthSample[];
  /** Anything that limits how the numbers above should be read. */
  notes: string[];
}
