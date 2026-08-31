/*
 * The unusual-activity screen's thresholds.
 *
 * They live in the types module, not beside the code that applies them, for
 * one reason: `compute.ts` is `server-only`, and the methodology drawer that
 * states these numbers renders on pages that also ship client components. A
 * drawer quoting a second, hand-copied set of numbers would eventually quote
 * numbers the screen no longer uses, which is worse than no drawer at all.
 */

/** Contracts below this volume are noise regardless of ratio. */
export const MIN_VOLUME = 250;
/** Below this ratio nothing is unusual enough to report. */
export const MIN_RATIO = 1.0;
/** Guards against a ratio blowing up on a contract with almost no open interest. */
export const MIN_OI = 50;
/** Most rows kept per symbol, so one busy name cannot swamp the table. */
export const PER_SYMBOL_CAP = 6;
/** Overall table cap. */
export const TOTAL_CAP = 60;

export type UnusualLevel = 'notable' | 'high' | 'extreme';

export interface FlowRow {
  symbol: string;
  /** `YYYY-MM-DD` */
  expiration: string;
  expiryLabel: string;
  strike: number;
  type: 'call' | 'put';
  volume: number;
  openInterest: number;
  /** volume / open interest. The core unusualness measure. */
  volumeToOi: number;
  /**
   * Dollars that changed hands: volume x price x 100.
   *
   * Priced off the mid where both sides are quoted, falling back to the last
   * trade. Null when neither is available, so the filter can exclude the row
   * rather than treat an unknown as zero.
   */
  premium: number | null;
  /** Share of the symbol's whole-chain volume sitting in this one contract. */
  shareOfChain: number;
  level: UnusualLevel;
  /** One line of plain language describing what is unusual. */
  note: string;
  /** Underlying price at snapshot, for context on how far out the strike is. */
  spot: number;
  /** Percent the strike sits away from spot. */
  distancePct: number;
}

export interface FlowSymbolSummary {
  symbol: string;
  spot: number;
  totalVolume: number;
  totalOpenInterest: number;
  contracts: number;
  flagged: number;
  /** Whole-chain put/call volume ratio. */
  putCallVolume: number | null;
  failed?: string;
}

/**
 * Bumped when the stored shape changes, so an older snapshot is rejected and
 * recomputed rather than passing validation and missing a field the page now
 * reads. Same reasoning as the sectors store.
 */
export const FLOW_SCHEMA = 3;

export interface FlowSnapshot {
  schema: number;
  /**
   * The trading session this scan describes, `YYYY-MM-DD` New York.
   *
   * Distinct from `computedAt`, and the distinction matters: the scan runs
   * after the close, so for most of the following day the page is showing the
   * previous session. Labelling only the compute time left a reader unable to
   * tell which day's flow they were looking at.
   *
   * Taken from the chain's own last-trade time rather than the wall clock, so
   * it stays correct whenever the job happens to run.
   */
  sessionDate: string;
  rows: FlowRow[];
  symbols: FlowSymbolSummary[];
  asOfLabel: string;
  computedAt: string;
  /** Symbols the run actually reached. */
  scanned: number;
  /**
   * Symbols on the configured list. Differs from `scanned` only when a run hit
   * its time budget. Optional so snapshots stored before this existed still
   * parse.
   */
  universe?: number;
  notes: string[];
}
