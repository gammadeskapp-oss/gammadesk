import type { Gics } from './universe';

/**
 * Shapes for the relative-strength engine.
 *
 * Two documents are stored per shard, and the split is the whole reason a page
 * view is cheap:
 *
 * - **bars** — the long price history. Big, written by the refresh job, and
 *   never read by a page.
 * - **digest** — the handful of numbers a ranking actually needs, derived from
 *   the bars at refresh time. Small enough that all four shards can be read on
 *   every page view.
 *
 * The digest stores *returns*, not scores. Percentile ranking is a property of
 * the whole universe rather than of one symbol, so it cannot be precomputed per
 * shard, and the blend weights are adjustable from the page — a stored
 * composite would be frozen at whatever weights happened to be in force when
 * the cron ran.
 */

/**
 * Bumped whenever a stored shape changes, so old documents are rejected and
 * rebuilt rather than read with a field that was never written. Version 2
 * added per-session volume.
 */
export const RS_SCHEMA = 2;

/**
 * One shard's price history.
 *
 * Closes are stored against a per-shard date index rather than one date per
 * bar. Dates are twelve bytes and closes are five, so repeating the calendar
 * 125 times over would have been most of the document. `closes[i]` lines up
 * with `dates[i]`, and `null` marks a session the symbol did not trade —
 * a halt, or any date before it listed.
 */
export interface BarShard {
  schema: number;
  shard: number;
  /** Every session date seen across this shard's symbols, oldest first. */
  dates: string[];
  /** Symbol to closes, aligned to `dates`. */
  closes: Record<string, (number | null)[]>;
  /**
   * Symbol to share volume, aligned to `dates`.
   *
   * Split-adjusted in the opposite direction to price, so `close * volume`
   * stays continuous across a split — see `applySplits` in `history.ts`.
   */
  volumes: Record<string, (number | null)[]>;
  /** When each symbol was last successfully fetched, ISO. */
  fetchedAt: Record<string, string>;
  updatedAt: string;
}

/** The three lookback windows, in trading sessions. */
export const WINDOWS = { m1: 21, m3: 63, m6: 126 } as const;

/**
 * How far back "a week ago" is for the rising/falling read.
 *
 * Five sessions rather than seven calendar days, so the comparison always spans
 * the same amount of trading regardless of holidays.
 */
export const TREND_LOOKBACK = 5;

/** Sessions averaged for the liquidity figure. */
export const LIQUIDITY_WINDOW = 20;

/**
 * Lookback for the RSI column, in sessions.
 *
 * Fourteen because that is what everyone else means by "RSI" — the /ticker
 * chart draws RSI(14), and a board that quietly used a different period would
 * have the two pages disagreeing about the same stock on the same day.
 */
export const RSI_PERIOD = 14;

/** Conventional overbought / oversold marks. */
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;

/**
 * Volume confirmation windows.
 *
 * The recent leg is the same 21 sessions as the 1-month performance window, so
 * "the move" and "the volume behind the move" cover the same ground. The
 * baseline is the three months *before* that leg — deliberately excluding the
 * recent window, because a baseline that contained the surge would be pulled up
 * by it and the ratio would understate what happened.
 */
export const VOLUME_RECENT = 21;
export const VOLUME_BASELINE = 63;

/**
 * Default liquidity floor, in dollars of average daily turnover.
 *
 * Ten million is low for the S&P 500 — most constituents trade many multiples
 * of it — which is the point: it removes the genuinely thin tail without
 * quietly deleting a fifth of the index. Adjustable from the page.
 */
export const DEFAULT_MIN_DOLLAR_VOLUME = 10_000_000;

/** One symbol's contribution to a ranking. */
export interface DigestEntry {
  symbol: string;
  /** `YYYY-MM-DD` of the newest bar behind these numbers. */
  asOfDate: string;
  close: number;
  /** Latest session change, as a fraction. Null when there is no prior bar. */
  changePct: number | null;
  /** Bars held for this symbol, so a short history can be reported honestly. */
  bars: number;
  /** 1mo / 3mo / 6mo total return as fractions. Null when history is short. */
  returns: { m1: number | null; m3: number | null; m6: number | null };
  /** The same three returns as they stood five sessions ago. */
  prior: { m1: number | null; m3: number | null; m6: number | null };
  /** Average daily dollar turnover over the last 20 sessions. */
  avgDollarVolume: number;
  /**
   * Recent average volume divided by the baseline before it.
   *
   * Above 1 means the last month traded more heavily than the three months
   * before it. Null when there is not enough history for both legs.
   */
  volumeRatio: number | null;
  /**
   * 14-day RSI on the latest bar, 0-100.
   *
   * Optional rather than required, and deliberately not guarded by a schema
   * bump: bumping `RS_SCHEMA` rejects the stored *bar* documents too, which
   * would throw away years of price history and rebuild it a shard a night for
   * a column. Digests are recomputed on every refresh, so an older document
   * simply has no RSI and the column shows a dash until that shard next runs.
   */
  rsi14?: number | null;

  /**
   * The two moving averages the intraday movers list reads, on the same
   * series the returns are measured on.
   *
   * EMA rather than SMA, and 20/200 rather than any other pair, because the
   * scanner's trend gate and its extended flag already use exactly these —
   * `readExtension` in `scanner/evaluate.ts` and `trendEmaPeriod` in
   * `config.ts`. Two pages calling the same stock extended and not-extended
   * on the same afternoon would be worse than the column being absent.
   *
   * Optional and deliberately not guarded by a schema bump, for the reason
   * spelled out on `rsi14` above: bumping `RS_SCHEMA` rejects the stored bar
   * documents too and would throw away years of price history to add a
   * column. A shard that predates these simply has no averages, and the
   * movers list reports the reading as unknown until that shard next runs.
   */
  ema20?: number | null;
  /**
   * The 50-day average, on the same series as `ema20` and `ema200`.
   *
   * Added alongside them for the swing candidate engine, which reads all three
   * to test that price sits above the full 20/50/200 stack. Same `ema()`
   * primitive, and the same unversioned-optional-field treatment: bumping
   * `RS_SCHEMA` would reject the stored *bar* documents and throw away years of
   * price history to add a column, so a shard that predates this simply has no
   * 50-day average and the reader that needs it either falls back to the bar
   * history (see `scanner/averages.ts`) or reports the reading as blank until
   * that shard next refreshes.
   */
  ema50?: number | null;
  ema200?: number | null;

  /**
   * Mean daily SHARE volume over the last 20 sessions.
   *
   * Shares, not dollars — `avgDollarVolume` above is the dollar figure and it
   * answers a different question. Relative volume is today's share count
   * against the name's own usual share count, and dividing a dollar total by
   * a share total would produce a number that moved with price.
   */
  avgVolume20?: number | null;
}

export interface DigestShard {
  schema: number;
  shard: number;
  entries: DigestEntry[];
  /** Symbols in this shard with no usable history, and why. */
  failures: Array<{ symbol: string; reason: string }>;
  computedAt: string;
}

/** Cursor and bookkeeping shared across shards. */
export interface RsMeta {
  schema: number;
  /** Which shard the next refresh should take. */
  cursor: number;
  /** Last completed run per shard, ISO. */
  ranAt: Record<string, string>;
  notes: string[];
}

// --- the ranked output the page renders --------------------------------------

export type Trend = 'RISING' | 'FALLING' | 'FLAT';

export interface Weights {
  m1: number;
  m3: number;
  m6: number;
}

/** Defaults from the brief. Adjustable from the page. */
export const DEFAULT_WEIGHTS: Weights = { m1: 0.2, m3: 0.5, m6: 0.3 };

export interface RsRow {
  /** Position in the full universe ranking, 1 = strongest. */
  rank: number;
  symbol: string;
  sector: Gics | null;
  sectorName: string | null;
  /** Themed groups this symbol belongs to, e.g. `["MAG7", "SEMI"]`. */
  groups: string[];

  /** 0-100 composite. */
  score: number;
  /** The same composite as it stood five sessions ago. Null when unknowable. */
  scorePrev: number | null;
  /** `score - scorePrev`. Null when there is no prior score. */
  delta: number | null;
  trend: Trend;

  /** Percentile rank per window, 0-100. Null where the history is too short. */
  percentiles: { m1: number | null; m3: number | null; m6: number | null };
  /** Raw performance per window, as fractions. */
  returns: { m1: number | null; m3: number | null; m6: number | null };

  close: number;
  changePct: number | null;
  asOfDate: string;
  /** How many of the three windows had enough history. */
  windows: number;

  /** Average daily dollar turnover over the last 20 sessions. */
  avgDollarVolume: number;
  /** Recent volume against its baseline. Above 1 = trading is picking up. */
  volumeRatio: number | null;
  /**
   * Whether the move has volume behind it.
   *
   * Null when there is not enough history to tell, which is honest rather than
   * defaulting to "unconfirmed" — those are different statements.
   */
  confirmation: Confirmation | null;

  /**
   * 14-day RSI, 0-100. Null where the shard predates the column or the history
   * is too short.
   *
   * A different axis to the score beside it: RSI measures the stock against its
   * own recent moves, RS measures it against the rest of the index.
   */
  rsi: number | null;

  /** The nine-signal score, where one is available. A different question. */
  signal: { score: number; bullish: number; total: number } | null;
}

export type Confirmation = 'confirmed' | 'unconfirmed';

export interface RsResult {
  rows: RsRow[];
  /** Symbols that were ranked. Percentiles are against exactly this many. */
  ranked: number;
  /** Symbols with history but excluded by the liquidity floor. */
  illiquid: number;
  /** Symbols in the universe with no usable history yet. */
  pending: number;
  universe: number;
  /** Newest bar date across the ranked symbols. */
  asOfDate: string;
  /** Oldest as-of date among the shards, when they disagree. */
  oldestShardDate: string;
  computedAt: string;
  weights: Weights;
  minDollarVolume: number;
  notes: string[];
}
