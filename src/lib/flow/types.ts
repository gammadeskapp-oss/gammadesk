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

export interface FlowSnapshot {
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
