export type Vote = 'bullish' | 'bearish';

/** One daily OHLCV bar. */
export interface Bar {
  /** `YYYY-MM-DD` */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Signal {
  id: string;
  name: string;
  vote: Vote;
  /** One line of plain English explaining the vote. */
  reason: string;
  /** The numbers behind it, shown small. */
  detail: string;
}

export type ConsensusLabel =
  | 'STRONG BULLISH'
  | 'BULLISH'
  | 'LEAN BULLISH'
  | 'LEAN BEARISH'
  | 'BEARISH'
  | 'STRONG BEARISH';

export interface Consensus {
  bullish: number;
  bearish: number;
  total: number;
  label: ConsensusLabel;
  /** Overall direction, for colouring. */
  vote: Vote;
}

export type LiquidityLabel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Liquidity {
  label: LiquidityLabel;
  /** 20-session average of close x volume, in dollars. */
  avgDollarVolume: number;
  avgShareVolume: number;
  /** Total contracts traded across the listed chain, or null when none. */
  optionsVolume: number | null;
  optionsOpenInterest: number | null;
  hasOptions: boolean;
  notes: string[];
}

export interface TickerAnalysis {
  symbol: string;
  name?: string;
  /** Latest close. */
  price: number;
  changePct: number;
  /** `YYYY-MM-DD` of the most recent bar. */
  asOfDate: string;
  asOfLabel: string;
  barsUsed: number;
  source: 'polygon' | 'yahoo';
  signals: Signal[];
  consensus: Consensus;
  liquidity: Liquidity;
  /** 52-week extremes, shown alongside the price. */
  high52: number;
  low52: number;
  cachedForSeconds: number;
}

export function consensusOf(signals: Signal[]): Consensus {
  const bullish = signals.filter((s) => s.vote === 'bullish').length;
  const total = signals.length;
  const bearish = total - bullish;

  // Thresholds are proportional so the labels survive a change in signal count.
  const share = total > 0 ? bullish / total : 0.5;

  let label: ConsensusLabel;
  if (share >= 0.85) label = 'STRONG BULLISH';
  else if (share >= 0.65) label = 'BULLISH';
  else if (share > 0.5) label = 'LEAN BULLISH';
  else if (share >= 0.35) label = 'LEAN BEARISH';
  else if (share >= 0.15) label = 'BEARISH';
  else label = 'STRONG BEARISH';

  return {
    bullish,
    bearish,
    total,
    label,
    vote: bullish >= bearish ? 'bullish' : 'bearish',
  };
}
