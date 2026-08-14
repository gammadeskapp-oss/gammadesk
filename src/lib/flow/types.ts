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
export const FLOW_SCHEMA = 2;

export interface FlowSnapshot {
  schema: number;
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
