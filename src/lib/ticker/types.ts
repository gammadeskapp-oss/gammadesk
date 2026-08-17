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
  /** One line of plain language explaining the vote. */
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

/**
 * The cutoffs a tier was decided by, carried alongside the tier itself.
 *
 * Shipped in the payload rather than duplicated in the component so the
 * tooltip can only ever state the thresholds that were actually applied.
 */
export interface TierCutoffs {
  high: number;
  medium: number;
}

/** Can I get in and out of the shares? */
export interface EquityLiquidity {
  tier: LiquidityLabel;
  /** Rolling average of close x volume, in dollars. */
  avgDollarVolume: number;
  avgShareVolume: number;
  /**
   * Quoted bid-ask spread as a percentage of the mid, from the underlying
   * quote. Null when the venue is not quoting two sides — never approximated
   * from volume or range, which measure something else entirely.
   */
  spreadPct: number | null;
  cutoffs: TierCutoffs;
  /** Sessions averaged, so the panel can say so. */
  sessions: number;
}

/** Are the contracts tradeable, and is the exposure maths worth trusting? */
export interface OptionsLiquidity {
  /** False when the symbol has no listed chain at all. */
  listed: boolean;
  /** Null only when nothing is listed. */
  tier: LiquidityLabel | null;
  /** Contracts traded across the whole chain. */
  volume: number | null;
  openInterest: number | null;
  /**
   * Volume-weighted quoted spread across two-sided contracts that actually
   * traded, as a percentage of the option's own mid — not of the share price,
   * which would make every cheap contract look catastrophic.
   */
  spreadPct: number | null;
  /** Contracts behind `spreadPct`, so a thin sample can be labelled as one. */
  spreadSample: number;
  /**
   * False when open interest sits under the configured floor. Every exposure
   * figure is open interest times a modelled greek, so below the floor the
   * GEX/VEX/CEX numbers are suppressed rather than shown.
   */
  exposureReliable: boolean;
  volumeCutoffs: TierCutoffs;
  openInterestCutoffs: TierCutoffs;
  minOpenInterestForExposure: number;
}

/**
 * "Tradeability" — how easily this one name can be dealt in.
 *
 * Named apart from US net liquidity (`lib/netLiquidity`), which is a
 * macro measure of money in the system and shares nothing with this but the
 * English word. Keeping the two labels distinct on screen is deliberate.
 */
export interface Liquidity {
  equity: EquityLiquidity;
  options: OptionsLiquidity;
  /** Quote timestamp from the options feed, when it supplied one. */
  asOfLabel: string | null;
  notes: string[];
}

/** Chart-ready series, shaped for lightweight-charts. */
export interface ChartPoint {
  /** `YYYY-MM-DD`, which lightweight-charts accepts as a business day. */
  time: string;
  value: number;
}

export interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TickerChartData {
  candles: ChartCandle[];
  ma50: ChartPoint[];
  ma200: ChartPoint[];
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
  chart: TickerChartData;
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
