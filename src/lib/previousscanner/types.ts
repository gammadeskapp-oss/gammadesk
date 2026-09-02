/**
 * Shapes for the morning scanner.
 *
 * Deliberately free of `server-only` and of any import that pulls it in: the
 * table and the chart are client components and need these types, and the NW
 * maths in `nadarayaWatson.ts` runs in both places so the scanner's reading and
 * the chart's band can never disagree about what they are drawing.
 */

/** The three timeframes the per-timeframe work is evaluated on. */
export const SCAN_TIMEFRAMES = ['1h', '4h', '1D'] as const;
export type ScanTimeframe = (typeof SCAN_TIMEFRAMES)[number];

/** What an anchored VWAP resets on. Per timeframe — see `config.scanner`. */
export type VwapAnchor = 'session' | 'week';

export const TIMEFRAME_LABEL: Record<ScanTimeframe, string> = {
  '1h': '1H',
  '4h': '4H',
  '1D': 'D',
};

/**
 * Every filter's outcome is one of three things, and `unknown` is not a polite
 * word for `fail`.
 *
 * A name whose NW cannot be computed has not failed the NW test — nobody ran
 * it. Collapsing the two would let missing data quietly masquerade as a
 * bearish reading, which is the single most misleading thing this page could
 * do. `unknown` excludes a ticker from the pass list exactly like `fail` does,
 * but it is displayed differently and the reason is always given.
 */
export type FilterState = 'pass' | 'fail' | 'unknown';

/**
 * The seven filters that gate the scan.
 *
 * Nadaraya-Watson used to be an eighth and is not one any more — it is a
 * *score* now, and it lives on `TimeframeReading.nw` rather than in this list.
 * See `NwReading` below for why.
 */
export const FILTER_KEYS = [
  'rs',
  'volume',
  'liquidity',
  'gamma',
  'spyGamma',
  'vwap',
  'ema',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Which filters are evaluated once, and which once per timeframe. */
export const SINGLE_FILTERS = ['rs', 'volume', 'liquidity', 'gamma', 'spyGamma'] as const;
export type SingleFilterKey = (typeof SINGLE_FILTERS)[number];

export const TIMEFRAME_FILTERS = ['vwap', 'ema'] as const;
export type TimeframeFilterKey = (typeof TIMEFRAME_FILTERS)[number];

export const FILTER_LABEL: Record<FilterKey, string> = {
  rs: 'RS',
  volume: 'Volume',
  liquidity: 'Liquidity',
  gamma: 'Gamma',
  spyGamma: 'SPY gamma',
  vwap: 'VWAP',
  ema: '200 EMA',
};

/** One filter's outcome, with the reading behind it. */
export interface FilterVerdict {
  state: FilterState;
  /** What the number actually was, e.g. `RS 94` or `below band`. */
  detail: string;
}

/**
 * Timeframes the Nadaraya-Watson band is computed on.
 *
 * **4H is deliberately absent.** The band width is a flat mean absolute error
 * over `lookback` bars, and Yahoo serves only about 252 four-hour bars against
 * the 499 the window asks for. The centre line does not care — the Gaussian
 * tail is negligible past a few dozen bars — but the edges are computed on
 * half the intended sample, and the edges are the entire reading. A number
 * that looks right and was measured over the wrong window is worse than no
 * number, so 4H reports no band at all rather than an approximate one.
 *
 * What would bring it back: a bar source serving the full 499 four-hour bars,
 * roughly two years of them. Add `'4h'` here and nothing else needs to change.
 * 4H still carries VWAP and the trend EMA, which need 200 bars at most and are
 * unaffected by this.
 */
export const NW_TIMEFRAMES = ['1h', '1D'] as const;
export type NwTimeframe = (typeof NW_TIMEFRAMES)[number];

export function hasNw(timeframe: ScanTimeframe): timeframe is NwTimeframe {
  return (NW_TIMEFRAMES as readonly string[]).includes(timeframe);
}

/**
 * Where price sits relative to the Nadaraya-Watson envelope.
 *
 * "Inside the band" is a different situation from "clearly below it", and the
 * entry being watched for is a close back *above* the band, which is only a
 * recognisable event if the in-band state is visible on the way there.
 *
 * `unavailable` means the band is not computed on this timeframe at all — see
 * `NW_TIMEFRAMES`. It is kept apart from `unknown`, which means it should have
 * been computed and could not be.
 */
export type NwState = 'above' | 'inside' | 'below' | 'unknown' | 'unavailable';

/**
 * The Nadaraya-Watson reading. A score, not a gate.
 *
 * ## Why it stopped being a filter
 *
 * The non-repainting endpoint estimator fits each bar from that bar and the
 * ones before it, which makes it hug recent price closely. The band width,
 * though, is the *window-average* absolute deviation over hundreds of bars. So
 * the quantity being tested — deviation at the endpoint — is structurally far
 * smaller than the quantity setting the threshold. Price clears the band only
 * in genuinely rare conditions, and requiring it on several timeframes at once
 * returned zero names on essentially every day: a dead page rather than a
 * strict one.
 *
 * Ranking keeps the information and drops the dead end. `z` is where the close
 * sits in units of half-band:
 *
 *     z = (close - centre) / (upper - centre)
 *
 * so `z > 1` is the old pass condition, `z = 0` sits on the centre line, and
 * `z = -1` is the lower edge. Names are ordered by it instead of cut by it.
 */
export interface NwReading {
  state: NwState;
  /**
   * Position in half-band units. Null when there is no band.
   *
   * Unbounded on purpose: clamping it would throw away exactly the separation
   * the ranking exists to show.
   */
  z: number | null;
  /** Envelope centre line. */
  mid: number | null;
  upper: number | null;
  lower: number | null;
  /** Bars the estimator actually had. */
  barsUsed: number;
  /** Bars it wanted. A short band sample is flagged, not hidden. */
  barsWanted: number;
}

/** One timeframe's reading: the two gating filters, plus the NW score. */
export interface TimeframeReading {
  timeframe: ScanTimeframe;
  /** Close of the most recent bar on this timeframe. */
  close: number | null;
  /** Which anchor the VWAP on this timeframe resets on. */
  vwapAnchor: VwapAnchor;
  vwap: number | null;
  ema: number | null;
  /** Scored, never gating. `state: 'unavailable'` where there is no band. */
  nw: NwReading;
  verdicts: Record<TimeframeFilterKey, FilterVerdict>;
  /** Bars available on this timeframe, or null when the fetch failed. */
  bars: number | null;
  /** Why this timeframe could not be read, when it could not. */
  error?: string;
}

/** How many timeframes must agree before VWAP and the trend EMA count as passed. */
export type StrictnessMode = 'all' | 'any2' | 'daily';

export const STRICTNESS_MODES: StrictnessMode[] = ['all', 'any2', 'daily'];

export const STRICTNESS_LABEL: Record<StrictnessMode, string> = {
  all: 'All 3 agree',
  any2: 'Any 2 of 3',
  daily: 'Daily only',
};

/** Which timeframes a mode consults. `all` and `any2` consult all three. */
export function timeframesForMode(mode: StrictnessMode): ScanTimeframe[] {
  return mode === 'daily' ? ['1D'] : [...SCAN_TIMEFRAMES];
}

/** How many of the consulted timeframes must pass. */
export function requiredAgreement(mode: StrictnessMode): number {
  if (mode === 'daily') return 1;
  return mode === 'any2' ? 2 : 3;
}

/** A gamma magnet — a strike holding a large share of positive exposure. */
export interface Magnet {
  strike: number;
  gex: number;
}

export type LiquidityTier = 'HIGH' | 'MEDIUM' | 'LOW';

/** What the 8:30 job stored for one symbol. */
export interface GammaEntry {
  symbol: string;
  /** `positive` = dealers dampen moves, `negative` = they amplify them. */
  regime: 'positive' | 'negative';
  netGex: number;
  spot: number;
  flipLevel: number | null;
  /** Largest positive-GEX strikes, biggest first. Drawn on the chart. */
  magnets: Magnet[];
  /** Whole-chain contract volume, for the options liquidity tier. */
  optionsVolume: number;
  /** Whole-chain open interest, same. */
  optionsOpenInterest: number;
  /** Timestamp the chain data itself refers to. */
  quoteDateIso: string;
}

export interface StoredGamma {
  /** New York date this refresh belongs to. */
  date: string;
  refreshedAt: string;
  /** Symbol to reading. */
  symbols: Record<string, GammaEntry>;
  failures: Array<{ symbol: string; reason: string }>;
  /** Candidates the budget did not reach. */
  skipped: string[];
  /** Candidate count the run set out to cover. */
  requested: number;
}

/** One ticker as the page renders it. */
export interface ScanRow {
  symbol: string;
  /** Latest daily close from the RS digest, with its own date. */
  price: number | null;
  priceAsOf: string;
  rsScore: number;
  rsRank: number;
  equityTier: LiquidityTier | null;
  optionsTier: LiquidityTier | null;
  regime: 'positive' | 'negative' | null;
  netGex: number | null;
  magnets: Magnet[];
  /** The five single-shot filters. */
  single: Record<SingleFilterKey, FilterVerdict>;
  /** The 3x3 grid: one reading per timeframe. */
  timeframes: TimeframeReading[];
}

/**
 * A finished scan, stored once and read all day.
 *
 * Every candidate is kept with all of its filter states — the pass list
 * and the near-miss list are both derived from this at render time, so
 * relaxing the strictness toggle never needs a re-scan.
 */
export interface ScanResult {
  /** New York date the scan belongs to. */
  date: string;
  scannedAt: string;
  /** Wall-clock the scan was scheduled for, from config. */
  scheduledEt: string;
  /** Every RS-clearing candidate, with every filter resolved. */
  rows: ScanRow[];
  /** Names in the S&P 500 universe considered. */
  universe: number;
  /** How many cleared filter 1 and were carried into the rest. */
  candidates: number;
  rsMin: number;
  /** SPY's own gamma regime — the market-wide gate. */
  spyRegime: 'positive' | 'negative' | null;
  /** Set when the scan returned nothing because SPY's gamma is not positive. */
  gateReason: string | null;
  /** Date of the gamma refresh these rows were built from. */
  gammaDate: string | null;
  gammaRefreshedAt: string | null;
  /** Candidates whose bars could not be read at all. */
  barFailures: string[];
  /** Candidates the bar-phase budget did not reach. */
  barSkipped: string[];
  notes: string[];
}

export interface StoredScans {
  scans: ScanResult[];
}
