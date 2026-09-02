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
 * The five rules the scanner scores against.
 *
 * ## They rank now; they do not gate
 *
 * These were five hard ANDed gates and the scan printed whatever survived all
 * five. Twice in a row that was zero names out of 503 — and an empty page
 * cannot even tell you which rule ate the list. So the five are scored and
 * weighted (`score.ts`), the list is always ordered, and the top of it is
 * always rendered. A name that fails a rule still fails it, in red, dimmed,
 * with the number that failed it printed beside it. Failing just no longer
 * makes a name invisible.
 *
 * ## Market regime is gone, and contract quality took its place
 *
 * The regime was the fifth key. It is one *market-wide* condition, so when it
 * failed it failed identically for every name in the universe and the page
 * went blank for a reason that had nothing to do with any of them. It is a
 * banner now — see `MARKET_REGIME_NOTE` — with one optional, default-off
 * toggle for a reader who wants the old behaviour.
 *
 * Contract quality is the fifth rule in its place. It was always a hard
 * requirement, it was simply resolved somewhere the rule list did not show;
 * naming it makes the thing that most often stops a good stock from being a
 * tradable idea visible in the same row as the reasons it looked good.
 *
 * ## What was removed earlier, and why
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
 * The 200 EMA rule is the **daily** one only. "Above the 200-day average" is a
 * statement someone can check; "above the 200-period average on two of three
 * timeframes, at the current agreement setting" is not.
 */
export const RULE_KEYS = [
  'rs',
  'ema',
  'volume',
  'liquidity',
  'contract',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export const RULE_LABEL: Record<RuleKey, string> = {
  rs: 'Relative strength',
  ema: '200-day average',
  volume: 'Volume',
  liquidity: 'Liquidity',
  contract: 'Contract',
};

/** Short form, for the badge row on a table line. */
export const RULE_SHORT: Record<RuleKey, string> = {
  rs: 'RS',
  ema: '200D',
  volume: 'VOL',
  liquidity: 'LIQ',
  contract: 'OPT',
};

/**
 * One sentence per filter, saying what passing it means in plain English.
 *
 * Rendered next to every gate, not tucked behind a tooltip. A pass/fail chip
 * labelled "SPY" tells a reader who already knows the rules that the rule
 * fired; it tells everyone else nothing at all, which on a page whose entire
 * output is a shortlist of stock tickers is the wrong way round.
 */
export const RULE_EXPLANATION: Record<RuleKey, string> = {
  rs: 'Outperforming most of the market over the last few months.',
  ema: 'Above the 200-day average — the long-term trend is up.',
  volume: 'Trading more than its own normal volume, so the move has participation behind it.',
  liquidity: 'Enough turnover to get in and out without moving the price.',
  contract:
    'There is an option in the chosen expiry and delta window that is actually worth trading.',
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
 * Kept for the result chart, which still draws the band. Nothing in the scan
 * reads it: it stopped gating (it was near-unsatisfiable at the shipped
 * multiplier), then stopped ranking, and is now a line on a chart and a
 * sentence beside it.
 *
 * `unavailable` means the band is not computed on this timeframe at all — see
 * `NW_TIMEFRAMES`. It is kept apart from `unknown`, which means it should have
 * been computed and could not be.
 */
export type NwState = 'above' | 'inside' | 'below' | 'unknown' | 'unavailable';


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
 * ## Why this number is also the length of the rendered list
 *
 * The constraint is Cboe's window, which the 08:30 gamma refresh has already
 * spent most of. A chain for every one of the 503 scored names is not close to
 * affordable, so the contract rule can only ever be *answered* for the top of
 * the ranking — and the page renders exactly that many rows, so that every row
 * on screen has had all five of its rules actually tested.
 *
 * Everything below it is graded when the reader opens it, and its contract
 * badge until then reads "not checked" in grey. That is not a failure and it
 * is not a pass: nobody looked. The same rule the earnings logic has always
 * applied.
 *
 * Overridable with `GAMMADESK_SCAN_CONTRACT_TOP_N` — see `config.scanner`.
 * This constant is the shipped default and the client's assumption about how
 * long the list is.
 */
export const OPTION_QUALITY_TOP_N = 25;

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

/**
 * The raw readings one rule verdict can be computed from.
 *
 * ## Numbers, never conclusions
 *
 * This type is the whole reason the controls on the page can be instant. The
 * scan stores *what it measured*; the browser decides what that amounts to,
 * against thresholds the reader owns — see `score.ts`. A stored `pass` would
 * be a conclusion drawn at one cutoff and then rendered under another, which
 * is the single thing an adjustable rule set must not do.
 *
 * It is also what makes scanning the whole index affordable. Every field here
 * comes out of the relative-strength digest, which is stored and already read
 * on every page view, so all 503 names can be scored without a single upstream
 * request. The old scan pulled three bar series per candidate and could
 * therefore only ever look at the couple of dozen names that had already
 * cleared the RS floor — which meant the floor could never be one of the
 * adjustable controls.
 */
export interface RowMetrics {
  /** 0-100 composite from /strength. */
  rsScore: number;
  /** Position in the full universe ranking, 1 = strongest. */
  rsRank: number;
  /** Percent above (positive) or below (negative) the 200-day average. */
  pctAbove200: number | null;
  ema200: number | null;
  /** Percent above or below the 20-day average. Drives the extended flag. */
  pctAbove20: number | null;
  ema20: number | null;
  /**
   * Recent volume against the name's own baseline. 1.0 is the confirmation
   * line. Null when there is not enough history for both legs — which is not
   * the same as unconfirmed and is never recorded as such.
   */
  volumeRatio: number | null;
  /** Average daily dollar turnover over the last 20 sessions. */
  avgDollarVolume: number;
}

/** One ticker as the page renders it. */
export interface ScanRow {
  symbol: string;
  /** Latest daily close from the RS digest, with its own date. */
  price: number | null;
  priceAsOf: string;
  /** Everything a rule verdict is computed from. See `RowMetrics`. */
  metrics: RowMetrics;
  equityTier: LiquidityTier | null;
  optionsTier: LiquidityTier | null;
  /**
   * The name's own dealer positioning. Context text on the row, not a rule -
   * see `RULE_KEYS` for why it stopped being one.
   *
   * Null for most names: the 08:30 job only refreshes chains for the RS-
   * clearing candidates, and the whole index is scored here.
   */
  regime: 'positive' | 'negative' | null;
  netGex: number | null;
  magnets: Magnet[];
  /** When it next reports. See `EarningsInfo` — unknown is not "no earnings". */
  earnings: EarningsInfo;
  /** How far it has run from its 20-day average. A flag, not a rule. */
  extension: ExtensionReading;
  /**
   * The contract check. Null means it has not been run for this name yet -
   * only the top `OPTION_QUALITY_TOP_N` by score are graded at scan time, and
   * an ungraded contract is unknown rather than bad.
   */
  optionQuality: OptionQuality | null;
}

/**
 * A finished scan, stored once and read all day.
 *
 * ## The whole index, with its readings, and no verdicts
 *
 * Every scored name is kept — not just the ones that would pass at some
 * setting — because the page's controls are applied to *this document* in the
 * browser and nothing else. A snapshot narrowed to the survivors at the
 * shipped cutoffs could not answer what happens at a lower one without the
 * scan running again, which would put the chain provider's request budget at
 * the mercy of a slider.
 *
 * It is affordable because `RowMetrics` comes entirely out of the stored
 * relative-strength digest. 503 names of readings is a few hundred kilobytes;
 * the old document held three bar-series summaries per candidate and covered
 * twenty-seven names.
 */
export interface ScanResult {
  /** New York date the scan belongs to. */
  date: string;
  scannedAt: string;
  /** Wall-clock the scan was scheduled for, from config. */
  scheduledEt: string;
  /** Every scored name in the universe, best first at the shipped weights. */
  rows: ScanRow[];
  /** Names in the S&P 500 universe considered. */
  universe: number;
  /** Names that had enough stored history to be scored at all. */
  scored: number;
  /**
   * The relative-strength cutoff the *page* opens on.
   *
   * No longer a pipeline bound: nothing is dropped for being below it. It is
   * carried so the page can label the default and so the archive can record
   * what "passed" meant that morning.
   */
  rsMin: number;
  /**
   * SPY's own gamma regime.
   *
   * A banner on the page now, not a per-name rule. See `MARKET_REGIME_NOTE`
   * for why one market-wide condition must not be evaluated 503 times.
   */
  spyRegime: 'positive' | 'negative' | null;
  /** Date of the gamma refresh these rows were built from. */
  gammaDate: string | null;
  gammaRefreshedAt: string | null;
  /** Names carrying an upcoming report inside the shipped 10-day buffer. */
  earningsExcluded: Array<{ symbol: string; dateIso: string; daysAway: number }>;
  /** Where the earnings dates came from this run, for the UI to state. */
  earningsSource: string;
  /** How many names had their chains pulled at scan time. */
  qualityChecked: number;
  /** How many the contract check was aimed at. See `OPTION_QUALITY_TOP_N`. */
  qualityTargeted: number;
  /** Names whose chain request failed, so the grey badge can say which. */
  qualityFailures: string[];
  notes: string[];
}

export interface StoredScans {
  scans: ScanResult[];
}
