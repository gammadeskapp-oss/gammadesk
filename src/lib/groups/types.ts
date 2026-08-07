import type { Vote } from '../ticker/types';

/** One ticker's result inside a group. */
export interface TickerScore {
  symbol: string;
  ok: true;
  price: number;
  changePct: number;
  bullish: number;
  total: number;
  vote: Vote;
  /** The individual signal votes, for the expanded view. */
  signals: Array<{ name: string; vote: Vote }>;
}

export interface TickerFailure {
  symbol: string;
  ok: false;
  reason: string;
}

export type TickerResult = TickerScore | TickerFailure;

export type GroupLabel = 'BULLISH' | 'NEUTRAL' | 'BEARISH';

export interface GroupScore {
  id: string;
  name: string;
  blurb: string;
  /** Tickers whose score resolved. */
  members: TickerScore[];
  failures: TickerFailure[];
  /** Tickers in the group leaning bullish overall. */
  bullishTickers: number;
  /** Tickers that resolved. */
  totalTickers: number;
  /** Every individual signal vote across the group. */
  bullishSignals: number;
  totalSignals: number;
  label: GroupLabel;
}

/** Breadth across every tracked symbol. */
export interface MarketInternals {
  universe: number;
  above20: number;
  above50: number;
  at4wHigh: number;
  at4wLow: number;
  above20Pct: number;
  above50Pct: number;
  at4wHighPct: number;
  at4wLowPct: number;
  /** -1 (worst) to +1 (best), used as the forecast's breadth input. */
  score: number;
}

export interface GroupsSnapshot {
  groups: GroupScore[];
  internals: MarketInternals;
  /** `YYYY-MM-DD` of the most recent bar seen. */
  asOfDate: string;
  computedAt: string;
  /** Upstream requests the refresh actually spent. */
  requests: number;
  source: 'yahoo' | 'polygon' | 'mixed';
  notes: string[];
}

export function labelFor(bullish: number, total: number): GroupLabel {
  if (total === 0) return 'NEUTRAL';
  const share = bullish / total;
  if (share >= 0.6) return 'BULLISH';
  if (share <= 0.4) return 'BEARISH';
  return 'NEUTRAL';
}
