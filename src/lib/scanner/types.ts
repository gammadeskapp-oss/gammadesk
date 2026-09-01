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
 * The five filters that gate the scan. All hard, all evaluated once.
 *
 * ## What was removed, and why
 *
 * There were seven, across three timeframes, with a strictness toggle
 * governing how many had to agree. Three are gone:
 *
 *  - **VWAP** left the scan entirely. Anchored on a session five minutes old
 *    it was a coin toss, and on the daily series it was very nearly the
 *    typical price. It survives on /decision, where the reader is looking at
 *    one name on a live chart and can see what it is doing.
 *  - **Nadaraya-Watson** is a line on the result chart now and nothing else.
 *    It already ranked rather than gated; ranking on it as well was giving a
 *    band-position score authority over the order of the list that the
 *    reading does not earn.
 *  - **Per-stock gamma** stopped gating because the single-name dealer-sign
 *    assumption is the weakest thing this app relies on. It shows as context
 *    text on the card, with that caveat attached, rather than silently
 *    removing names on the strength of an assumption.
 *
 * The 200 EMA gate is now the **daily** one only. "Above the 200-day average"
 * is a statement someone can check; "above the 200-period average on two of
 * three timeframes, at the current agreement setting" is not.
 *
 * There is no strictness toggle and no near-miss list. Five gates, all hard,
 * and a name either clears them or is not on the page.
 */
export const FILTER_KEYS = [
  'rs',
  'ema',
  'volume',
  'liquidity',
  'spyGamma',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const FILTER_LABEL: Record<FilterKey, string> = {
  rs: 'Relative strength',
  ema: '200-day average',
  volume: 'Volume',
  liquidity: 'Liquidity',
  spyGamma: 'Market regime',
};

/**
 * One sentence per filter, saying what passing it means in plain English.
 *
 * Rendered next to every gate, not tucked behind a tooltip. A pass/fail chip
 * labelled "SPY" tells a reader who already knows the rules that the rule
 * fired; it tells everyone else nothing at all, which on a page whose entire
 * output is a shortlist of stock tickers is the wrong way round.
 */
export const FILTER_EXPLANATION: Record<FilterKey, string> = {
  rs: 'Outperforming most of the market over the last few months.',
  ema: 'Above the 200-day average — the long-term trend is up.',
  volume: 'Trading more than its own normal volume, so the move has participation behind it.',
  liquidity: 'Enough shares and contracts change hands to get in and out without moving the price.',
  spyGamma: 'The wider market is in a calm regime, where dealer hedging damps moves rather than amplifying them.',
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
 * 4H still carries the trend EMA, which needs 200 bars at most and is
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
 * It briefly ranked the list instead. That is gone too: band position is a
 * reading about one name against its own recent regression, and letting it
 * decide the order of a shortlist gave it an authority over the reader's
 * attention it does not earn. The list ranks on relative strength.
 *
 * What is left is a line on the chart. `z` is where the close sits in units of
 * half-band:
 *
 *     z = (close - centre) / (upper - centre)
 *
 * so `z = 0` sits on the centre line and `z = -1` is the lower edge. It is
 * shown beside the chart as context and gates nothing.
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

/**
 * One timeframe's reading.
 *
 * No verdicts any more. Nothing here gates: the 200-day average gate is
 * computed once, on the daily series, and lives in `ScanRow.single`. What is
 * left is the material the result chart draws — the trend line and the
 * Nadaraya-Watson envelope — plus the bar counts that say how much history
 * either was measured over.
 */
export interface TimeframeReading {
  timeframe: ScanTimeframe;
  /** Close of the most recent bar on this timeframe. */
  close: number | null;
  /** The trend average — 200 periods, from `config.scanner.trendEmaPeriod`. */
  ema: number | null;
  /**
   * The short average the extended flag is measured against.
   *
   * Carried here rather than recomputed by the caller because the bars are
   * already in hand at this point and nowhere else has them — the stored scan
   * keeps readings, not series.
   */
  ema20: number | null;
  /** Drawn on the chart. Never a gate and no longer a ranking input. */
  nw: NwReading;
  /** Bars available on this timeframe, or null when the fetch failed. */
  bars: number | null;
  /** Why this timeframe could not be read, when it could not. */
  error?: string;
}


// --- earnings, extension, and option quality ---------------------------------

/**
 * When a name next reports earnings.
 *
 * ## `unknown` is never "no earnings soon"
 *
 * This is the rule the whole type exists to enforce. A missing earnings date
 * means nobody looked it up successfully - it does not mean the date is far
 * away. Collapsing the two would let a name reporting tomorrow onto a
 * shortlist with a clean bill of health, which is the worst thing this page
 * could output.
 *
 * So `state` is explicit, the exclusion rule reads it rather than reading
 * `daysAway`, and an unknown name is let through *with the uncertainty printed
 * on its watch line*. Let through, because excluding every name whose date
 * could not be fetched would empty the page whenever the fundamentals endpoint
 * is unavailable.
 */
export type EarningsState = 'known' | 'unknown';

export interface EarningsInfo {
  state: EarningsState;
  /** `YYYY-MM-DD`, or null when unknown. */
  dateIso: string | null;
  /** Calendar days from the scan date. Negative is in the past. Null when unknown. */
  daysAway: number | null;
  /** Where the date came from, or why there is none. Always populated. */
  source: string;
}

/** Calendar days inside which an upcoming report excludes a name outright. */
export const EARNINGS_EXCLUSION_DAYS = 10;

/**
 * How far price has run from its 20-day average.
 *
 * A flag, never a rejection. A name 6% above its 20-day average is doing
 * exactly what a strong name does; it is also a worse place to be starting
 * from than the same name at 1%. Rejecting on it would throw away the
 * strongest names in the list for being strong.
 */
export interface ExtensionReading {
  /** Percent above (positive) or below (negative) the 20-day EMA. Null when unreadable. */
  pctAbove20Ema: number | null;
  ema20: number | null;
  /** True past `EXTENDED_PCT`. An unreadable EMA is not extended. */
  extended: boolean;
}

/** Distance above the 20-day average at which a name is called extended. */
export const EXTENDED_PCT = 5;

/**
 * The option-quality badge.
 *
 * `unknown` is a fifth state and not a polite word for `caution`. A contract
 * whose spread or open interest could not be read has not been graded at all,
 * and the one thing this gate must never do is show a green badge over
 * incomplete data - the whole point of it is that a good stock with an
 * untradable contract is a bad idea, and the reader cannot see that from the
 * stock alone.
 */
export type OptionQualityBadge =
  | 'excellent'
  | 'tradable'
  | 'caution'
  | 'avoid'
  | 'unknown';

export const OPTION_BADGE_LABEL: Record<OptionQualityBadge, string> = {
  excellent: 'Excellent',
  tradable: 'Tradable',
  caution: 'Caution',
  avoid: 'Avoid',
  unknown: 'Unknown',
};

/** The contract the gate actually graded, and the numbers behind the badge. */
export interface OptionContract {
  /** `YYYY-MM-DD` */
  expiration: string;
  strike: number;
  /** Calendar days to expiry. */
  dte: number;
  /** Modelled from the quoted IV - Cboe does not publish delta. Null when unusable. */
  delta: number | null;
  openInterest: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  /** `(ask - bid) / mid`, as a percentage. Null when either side is missing. */
  spreadPctOfMid: number | null;
  /** Quoted implied volatility, as a percentage. */
  ivPct: number | null;
}

/** Whether the chain behind a badge was pulled by the scan or on demand. */
export type OptionQualitySource = 'scan' | 'on-click';

export interface OptionQuality {
  badge: OptionQualityBadge;
  /** The best contract found in the window, or null when none was. */
  contract: OptionContract | null;
  /**
   * Plain-English reasons for the badge, worst first. Never empty - a badge
   * with no stated reason is a number the reader is being asked to trust.
   */
  reasons: string[];
  source: OptionQualitySource;
  /** When the chain behind this was read. */
  checkedAt: string;
  /** The quote timestamp of the chain itself, which is what staleness is judged on. */
  quoteDateIso: string | null;
}

/** The DTE and delta window the gate looks in. */
export const OPTION_WINDOW = {
  minDte: 30,
  maxDte: 60,
  minDelta: 0.55,
  maxDelta: 0.7,
} as const;

/**
 * How many ranked names the scan pulls chains for.
 *
 * The constraint is Cboe's window, which the 08:30 gamma refresh has already
 * spent most of. Ten more is affordable every day; a chain per candidate would
 * put the scan over the quota on its own. Everything below the tenth is graded
 * when the reader asks for it, and each result says which of the two it got.
 */
export const OPTION_QUALITY_TOP_N = 10;

/**
 * The risks attached to one result, in plain English.
 *
 * Never empty. `buildWatchLine` returns "Nothing flagged" rather than nothing
 * at all, because a result rendered with no watch line reads as a result with
 * nothing to watch, and those are different claims.
 */
export interface WatchLine {
  items: string[];
  text: string;
}


// --- alignment badges --------------------------------------------------------

/**
 * The four things a reader actually wants to know at a glance, each answered
 * from its own evidence.
 *
 * ## Why these are not just the five gates repainted
 *
 * Every name on the pass list has all five gates green by definition, so five
 * green chips would carry no information at all. These four are chosen because
 * they *vary between names that all passed*:
 *
 *  - **Trend aligned** wants the long trend and the short one pointing the
 *    same way. The gate is the 200-day average alone; a name can clear that
 *    and still be under its 20-day, which is a genuinely different picture.
 *  - **Momentum confirmed** is the volume gate plus the extension flag. A name
 *    that has already run 8% past its 20-day average has confirmed momentum
 *    and a worse place to start from, and the badge says so.
 *  - **Options liquid** comes from the contract check, which is the one thing
 *    upstream never measured.
 *  - **Market aligned** is the market regime. Constant across a single scan by
 *    construction, and kept anyway: it is the badge that explains why the list
 *    is empty on the days it is empty, and it varies in the archive.
 *
 * ## Amber is not a shade of green
 *
 * `unknown` exists because the alternative is worse. The instruction was that
 * each badge is red or green on its own evidence and that none may be weighted
 * or hidden to produce more green — so a badge with no evidence behind it is
 * never green, and it is never quietly dropped either. It renders grey, states
 * why, and counts as not-green everywhere it is counted.
 */
export const ALIGNMENT_KEYS = [
  'market',
  'momentum',
  'trend',
  'options',
] as const;
export type AlignmentKey = (typeof ALIGNMENT_KEYS)[number];

export const ALIGNMENT_LABEL: Record<AlignmentKey, string> = {
  market: 'Market aligned',
  momentum: 'Momentum confirmed',
  trend: 'Trend aligned',
  options: 'Options liquid',
};

export interface AlignmentBadge {
  key: AlignmentKey;
  /** `unknown` is never counted as aligned. See above. */
  state: FilterState;
  /** The evidence, in plain English. Never empty. */
  detail: string;
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
  /**
   * The name's own dealer positioning. Context text on the card, not a gate -
   * see `FILTER_KEYS` for why it stopped being one.
   */
  regime: 'positive' | 'negative' | null;
  netGex: number | null;
  magnets: Magnet[];
  /** All five gates. */
  single: Record<FilterKey, FilterVerdict>;
  /** One reading per timeframe, for the chart. Nothing here gates. */
  timeframes: TimeframeReading[];
  /** When it next reports. Excludes the name inside the window; see `EarningsInfo`. */
  earnings: EarningsInfo;
  /** How far it has run from its 20-day average. A flag, not a gate. */
  extension: ExtensionReading;
  /**
   * The contract check. Null means it has not been run for this name yet -
   * only the top `OPTION_QUALITY_TOP_N` are graded at scan time.
   */
  optionQuality: OptionQuality | null;
}

/**
 * A finished scan, stored once and read all day.
 *
 * Every candidate is kept with all five of its gate states, so the page can
 * show its working on a zero-result morning rather than rendering an empty box
 * with no account of what was tested.
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
  /** Names excluded outright for reporting earnings inside the window. */
  earningsExcluded: Array<{ symbol: string; dateIso: string; daysAway: number }>;
  /** Where the earnings dates came from this run, for the UI to state. */
  earningsSource: string;
  /** How many names had their chains pulled at scan time. */
  qualityChecked: number;
  notes: string[];
}

export interface StoredScans {
  scans: ScanResult[];
}
