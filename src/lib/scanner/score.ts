/**
 * Scoring, filter verdicts, and the funnel — the whole of the scanner's
 * judgement, in one client-safe, dependency-free file.
 *
 * ## Two separate jobs, deliberately kept apart
 *
 * **Scoring** blends seven components into one 0-100 number per name, over the
 * whole ranked universe, and that number is the only thing that decides the
 * order of the list. It does not read the reader's settings at all.
 *
 * **Filtering** then decides which of those ordered names match what the
 * reader asked for. It reads nothing but `ScanRow.metrics` and a
 * `FilterSettings` the reader owns, so moving a control re-decides every row
 * instantly and without touching the network.
 *
 * Keeping them apart is what makes the page unemptiable. The table renders the
 * top `SCANNER_TOP_N` by score whatever the filters say; filters narrow the
 * set of rows marked as matching, and the rows that do not match stay on
 * screen, dimmed, with the reading that missed printed beside them. "Nothing
 * matched" is then a sentence on a full page rather than a blank one.
 *
 * ## The server stores numbers, never conclusions
 *
 * Nothing here reads a stored verdict. A stored `pass` would be a conclusion
 * drawn at one cutoff and rendered under another, which is the single thing an
 * adjustable filter set must not do.
 *
 * ## Ranking is not recommending
 *
 * A name at the top of this list is the name nothing scored higher than. It is
 * not a suggestion. That is why failing names are dimmed rather than removed,
 * why every caution stays visible next to every positive, and why nothing in
 * this file or the page it feeds ever phrases a row as something to buy or
 * sell.
 */

import { excludedForEarnings } from './earningsRules';
import {
  OPTION_WINDOW,
  RULE_KEYS,
  RULE_LABEL,
  type FilterVerdict,
  type RowMetrics,
  type RuleKey,
  type ScanRow,
} from './types';

// --- the market-wide readings a score needs ----------------------------------

/**
 * Everything a score needs that is not a property of the name itself.
 *
 * One field today, and a parameter rather than a copy on every row on purpose:
 * SPY's regime is one reading, and duplicating it 503 times into the stored
 * document would create 503 opportunities for it to disagree with itself.
 */
export interface MarketContext {
  spyRegime: 'positive' | 'negative' | null;
}

// --- the weights -------------------------------------------------------------

export const SCORE_KEYS = [
  'rs',
  'trend',
  'volume',
  'vwap',
  'tickerGamma',
  'spyGamma',
  'optionLiquidity',
] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export type ScoreWeights = Record<ScoreKey, number>;

/**
 * What each component is worth in the composite, before renormalisation.
 *
 * Equal weight everywhere except relative strength, which counts double. That
 * is the one claim these numbers make, and it is deliberate: RS is the reading
 * this whole page is built around, it is measured against the entire index
 * rather than against the name's own history, and the reader can go and check
 * it on /strength. The other six are each one vote.
 *
 * They do not have to sum to anything — `scoreRow` renormalises over the
 * components a given name actually has a reading for.
 */
export const SCORE_WEIGHTS: ScoreWeights = {
  rs: 2,
  trend: 1,
  volume: 1,
  vwap: 1,
  tickerGamma: 1,
  spyGamma: 1,
  optionLiquidity: 1,
};

/** Column headings and the plain-English account of each component. */
export const SCORE_LABEL: Record<ScoreKey, string> = {
  rs: 'RS',
  trend: 'Trend',
  volume: 'Volume',
  vwap: 'VWAP',
  tickerGamma: 'Gamma',
  spyGamma: 'Market',
  optionLiquidity: 'Options',
};

export const SCORE_EXPLANATION: Record<ScoreKey, string> = {
  rs: 'Where it ranks against the whole index over the last one, three and six months. Counts double — it is the reading this page is built around.',
  trend:
    'Four readings averaged: above its 50-day average, above its 200-day average, the 50 above the 200, and where its last month ranks against the rest of the index.',
  volume:
    "The last month's average volume against the three months before it. 1.0x — merely confirmed — scores low; heavy participation scores high.",
  vwap: 'How far the close sits above the volume-weighted average price of the last twenty sessions. This is a daily VWAP, not the intraday session one.',
  tickerGamma:
    "This name's own dealer positioning. Positive scores higher. On a single stock the assumption about which side dealers are on is weak, which is why it is one vote of seven.",
  spyGamma:
    "The wider market's dealer positioning. Identical for every name on the page — it moves the whole list, never the order of it.",
  optionLiquidity:
    'Whole-chain option volume and open interest, whichever is weaker. Whether the options on it trade at all, before any question of which contract.',
};

// --- the reader's settings ---------------------------------------------------

/**
 * Every threshold the page exposes, and the on/off switch for each filter.
 *
 * Serialised into the query string, so a configuration can be bookmarked and
 * sent to someone else — see `filterState.ts`. Nothing here reaches the
 * server: it is applied to the cached snapshot in the browser.
 */
export interface FilterSettings {
  /** Composite relative-strength score a name must clear. */
  rsMin: number;
  /** Trend sub-score a name must clear, 0-100. */
  trendMin: number;
  /** Recent volume as a multiple of the name's own baseline. */
  volumeMult: number;
  /** Average daily dollar turnover floor. */
  minDollarVolume: number;
  /** Days to expiry the contract check looks in. */
  dteMin: number;
  dteMax: number;
  deltaMin: number;
  deltaMax: number;
  /** Calendar days inside which an upcoming report excludes a name. */
  earningsBufferDays: number;
  /** Which filters are switched on. */
  enabled: Record<RuleKey, boolean>;
}

/**
 * The shipped defaults: relative strength above 80, a turnover floor, and
 * nothing else.
 *
 * Loose on purpose. The page opens on the ranking rather than on one
 * particular opinion about it, and every filter beyond these two is visibly
 * the reader's own choice rather than something they inherited. The two that
 * are on are the two that are close to structural — a scanner with no strength
 * requirement is not a scanner, and a name nobody can get out of is not
 * tradable at any score.
 */
export const DEFAULT_FILTERS: FilterSettings = {
  rsMin: 80,
  trendMin: 50,
  volumeMult: 1,
  // The equity `HIGH` tier cutoff from `config.tradeability`.
  minDollarVolume: 250_000_000,
  dteMin: OPTION_WINDOW.minDte,
  dteMax: OPTION_WINDOW.maxDte,
  deltaMin: OPTION_WINDOW.minDelta,
  deltaMax: OPTION_WINDOW.maxDelta,
  earningsBufferDays: 10,
  enabled: {
    rs: true,
    liquidity: true,
    trend: false,
    volume: false,
    vwap: false,
    gamma: false,
    spy: false,
    contract: false,
  },
};

/** Slider bounds, kept here so the controls and the clamping cannot disagree. */
export const FILTER_BOUNDS = {
  rsMin: { min: 50, max: 99, step: 1 },
  trendMin: { min: 0, max: 100, step: 1 },
  volumeMult: { min: 1, max: 3, step: 0.05 },
  minDollarVolume: { min: 10_000_000, max: 1_000_000_000, step: 10_000_000 },
  dte: { min: 7, max: 120, step: 1 },
  delta: { min: 0.2, max: 0.9, step: 0.01 },
  earningsBufferDays: { min: 0, max: 60, step: 1 },
} as const;

export function clampSettings(s: FilterSettings): FilterSettings {
  const clamp = (v: number, lo: number, hi: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

  const b = FILTER_BOUNDS;
  const dteMin = clamp(s.dteMin, b.dte.min, b.dte.max);
  const deltaMin = clamp(s.deltaMin, b.delta.min, b.delta.max);

  return {
    ...s,
    rsMin: clamp(s.rsMin, b.rsMin.min, b.rsMin.max),
    trendMin: clamp(s.trendMin, b.trendMin.min, b.trendMin.max),
    volumeMult: clamp(s.volumeMult, b.volumeMult.min, b.volumeMult.max),
    minDollarVolume: clamp(
      s.minDollarVolume,
      b.minDollarVolume.min,
      b.minDollarVolume.max,
    ),
    dteMin,
    // The dual sliders cannot cross. Clamped rather than swapped: a crossed
    // range is a dragging accident, and swapping silently would leave the
    // reader looking at a window they did not ask for.
    dteMax: clamp(s.dteMax, dteMin, b.dte.max),
    deltaMin,
    deltaMax: clamp(s.deltaMax, deltaMin, b.delta.max),
    earningsBufferDays: clamp(
      s.earningsBufferDays,
      b.earningsBufferDays.min,
      b.earningsBufferDays.max,
    ),
  };
}

// --- component scores --------------------------------------------------------

/** Linear map onto 0-100, clamped at both ends. */
function ramp(value: number, low: number, high: number): number {
  if (!(high > low)) return 0;
  return Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
}

/**
 * The trend sub-score, and the four readings behind it.
 *
 * ## Why four, and why they are averaged rather than ANDed
 *
 * Three of them are structural facts about where price sits — above the 50,
 * above the 200, and the 50 above the 200, which is the ordering that
 * distinguishes a name that has been strong for months from one that bounced
 * last week. The fourth is the last month's return as a percentile of the
 * index, which is the only one of the four that knows anything about the rest
 * of the market.
 *
 * ANDing them would produce a boolean, and the column exists precisely because
 * a boolean cannot tell a name three of four from a name none of four.
 * Averaging keeps the ordering inside the middle of the list, which is where
 * every interesting name is.
 *
 * Each missing reading is dropped and the average is taken over what is left,
 * for the same reason the composite renormalises: a name with fewer than 200
 * daily bars has not fallen below its 200-day average, nobody could compute
 * one. `null` — every reading missing — is not zero and never scores as one.
 */
export interface TrendParts {
  above50: boolean | null;
  above200: boolean | null;
  goldenOrder: boolean | null;
  m1Percentile: number | null;
}

export interface TrendScore {
  /** 0-100, or null when not one of the four could be read. */
  value: number | null;
  parts: TrendParts;
  /** How many of the four contributed. */
  measured: number;
}

export function trendScore(m: RowMetrics): TrendScore {
  const parts: TrendParts = {
    above50: m.pctAbove50 === null ? null : m.pctAbove50 >= 0,
    above200: m.pctAbove200 === null ? null : m.pctAbove200 >= 0,
    goldenOrder:
      m.ema50 === null || m.ema200 === null ? null : m.ema50 >= m.ema200,
    m1Percentile:
      m.m1Percentile === null
        ? null
        : Math.min(100, Math.max(0, m.m1Percentile)),
  };

  const values: number[] = [];
  if (parts.above50 !== null) values.push(parts.above50 ? 100 : 0);
  if (parts.above200 !== null) values.push(parts.above200 ? 100 : 0);
  if (parts.goldenOrder !== null) values.push(parts.goldenOrder ? 100 : 0);
  if (parts.m1Percentile !== null) values.push(parts.m1Percentile);

  return {
    value:
      values.length === 0
        ? null
        : values.reduce((sum, v) => sum + v, 0) / values.length,
    parts,
    measured: values.length,
  };
}

export type ScoreComponents = Record<ScoreKey, number | null>;

export interface RowScore {
  /** 0-100. */
  total: number;
  components: ScoreComponents;
  /** Components that had no reading, so the blend can be reported honestly. */
  missing: ScoreKey[];
  /** The trend arithmetic, kept for the column's tooltip and the detail row. */
  trend: TrendScore;
}

/**
 * One name's composite, 0-100.
 *
 * ## Missing readings shrink the blend, they do not score zero
 *
 * This is the rule the earnings logic has always applied, moved somewhere else
 * it matters. Most of the index has no dealer-positioning reading at all — the
 * morning gamma job pulls a few dozen chains, not five hundred — and scoring
 * those absences as zero would rank the whole index below the shortlist on the
 * strength of which chains the job had time for. That would be a statement
 * about this site's request budget dressed up as a statement about the market.
 *
 * So an absent component is dropped and the remaining weights are renormalised
 * over what is left. The page prints which ones were dropped on every row.
 */
export function scoreRow(
  row: ScanRow,
  market: MarketContext,
  weights: ScoreWeights = SCORE_WEIGHTS,
): RowScore {
  const m = row.metrics;
  const trend = trendScore(m);

  const components: ScoreComponents = {
    // Already a 0-100 percentile composite. Used as-is: rescaling a score the
    // reader can look up on /strength would make the two pages disagree.
    rs: Number.isFinite(m.rsScore) ? Math.min(100, Math.max(0, m.rsScore)) : null,

    trend: trend.value,

    // 0.5x to 2.5x its own baseline. 1.0 — the confirmation line — lands at 25,
    // so merely confirmed is a low score and heavy participation is a high one.
    volume: m.volumeRatio === null ? null : ramp(m.volumeRatio, 0.5, 2.5),

    /*
     * -5% to +10% against the 20-session VWAP, so the component is a distance
     * rather than a coin flip. A name 4% above the price most of the recent
     * volume traded at is in a different position from one 0.1% above, and
     * scoring both 100 would throw that away — which is most of what this
     * reading has to offer.
     */
    vwap: m.pctAboveVwap === null ? null : ramp(m.pctAboveVwap, -5, 10),

    /*
     * A two-valued reading, scored 100 and 25 rather than 100 and 0.
     *
     * Negative dealer gamma is a real caution and it is stated in words on
     * every row that has it, but the single-name dealer-sign assumption is the
     * weakest thing this site relies on — nobody publishes who is on which
     * side of a single stock's chain. Scoring it zero would let an inference
     * knock a name down the list as hard as a measured fact does.
     */
    tickerGamma: row.regime === null ? null : row.regime === 'positive' ? 100 : 25,

    /*
     * Identical for every name on the page, which is exactly why it is safe
     * here and was not safe as a gate. As one component of seven it lifts or
     * lowers the whole list without touching the order; as a gate it emptied
     * the page on every volatile morning.
     */
    spyGamma:
      market.spyRegime === null ? null : market.spyRegime === 'positive' ? 100 : 25,

    optionLiquidity: optionLiquidityScore(row),
  };

  let weighted = 0;
  let totalWeight = 0;
  const missing: ScoreKey[] = [];

  for (const key of SCORE_KEYS) {
    const value = components[key];
    if (value === null) {
      missing.push(key);
      continue;
    }
    weighted += value * weights[key];
    totalWeight += weights[key];
  }

  return {
    // No readings at all is a zero, and it will sort to the bottom where a
    // name nobody could measure belongs.
    total: totalWeight > 0 ? weighted / totalWeight : 0,
    components,
    missing,
    trend,
  };
}

/**
 * Whether the options on this name trade at all.
 *
 * The weaker of contract volume and open interest, never their average — the
 * same rule `ticker/liquidity.ts` applies, and for the same reason: they fail
 * in different ways and averaging lets either paper over the other. A chain
 * with vast open interest and no volume today is not liquid.
 *
 * Log-scaled, because linear would put every mega-cap chain at 100 and
 * everything else near zero, which measures index membership rather than
 * tradability. Null for any name the morning job did not pull a chain for,
 * which is most of them.
 */
function optionLiquidityScore(row: ScanRow): number | null {
  const volume = row.optionsVolume;
  const openInterest = row.optionsOpenInterest;
  if (volume === null || openInterest === null) return null;

  // 1k to 1M contracts, which spans the S&P chains from the barely-quoted to
  // the index proxies.
  const byVolume = volume > 0 ? ramp(Math.log10(volume), 3, 6) : 0;
  const byOi = openInterest > 0 ? ramp(Math.log10(openInterest), 3, 6) : 0;
  return Math.min(byVolume, byOi);
}

// --- filter verdicts ---------------------------------------------------------

function fmtDollars(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}bn`;
  return `$${Math.round(v / 1e6)}M`;
}

/**
 * The eight filters, resolved against the reader's settings.
 *
 * Always all eight, always in `RULE_KEYS` order, never filtered and never
 * suppressed when the answer is red. A filter the reader has switched off
 * still returns its verdict — the caller renders it dimmed and stops counting
 * it — because a filter that vanishes when disabled takes its reading with it,
 * and the reading was the point.
 *
 * `unknown` is never a pass and never a fail. It is the third state this whole
 * page is built around: a name whose 200-day average could not be computed has
 * not fallen below it, and a chain nobody pulled has not scored badly.
 */
export function ruleVerdicts(
  row: ScanRow,
  settings: FilterSettings,
  market: MarketContext,
): Record<RuleKey, FilterVerdict> {
  const m = row.metrics;
  const trend = trendScore(m);

  const rs: FilterVerdict = Number.isFinite(m.rsScore)
    ? m.rsScore >= settings.rsMin
      ? { state: 'pass', detail: `RS ${m.rsScore.toFixed(0)}, at or above the ${settings.rsMin} cutoff` }
      : { state: 'fail', detail: `RS ${m.rsScore.toFixed(0)}, below the ${settings.rsMin} cutoff` }
    : { state: 'unknown', detail: 'no relative-strength reading' };

  const trendVerdict: FilterVerdict =
    trend.value === null
      ? {
          state: 'unknown',
          detail:
            'not one of the four trend readings could be taken, so there is no trend score',
        }
      : trend.value >= settings.trendMin
        ? {
            state: 'pass',
            detail: `trend ${trend.value.toFixed(0)}, at or above the ${settings.trendMin} cutoff (${describeTrendParts(trend)})`,
          }
        : {
            state: 'fail',
            detail: `trend ${trend.value.toFixed(0)}, below the ${settings.trendMin} cutoff (${describeTrendParts(trend)})`,
          };

  const volume: FilterVerdict =
    m.volumeRatio === null
      ? {
          state: 'unknown',
          detail: 'not enough history to compare against its normal volume',
        }
      : m.volumeRatio >= settings.volumeMult
        ? {
            state: 'pass',
            detail: `${m.volumeRatio.toFixed(2)}x its own normal volume`,
          }
        : {
            state: 'fail',
            detail: `${m.volumeRatio.toFixed(2)}x its normal volume, under the ${settings.volumeMult.toFixed(2)}x cutoff`,
          };

  const vwap: FilterVerdict =
    m.pctAboveVwap === null
      ? {
          state: 'unknown',
          detail:
            'fewer than twenty sessions of price and volume, so no daily VWAP could be computed',
        }
      : m.pctAboveVwap >= 0
        ? {
            state: 'pass',
            detail: `${m.pctAboveVwap.toFixed(1)}% above its 20-session VWAP`,
          }
        : {
            state: 'fail',
            detail: `${Math.abs(m.pctAboveVwap).toFixed(1)}% below its 20-session VWAP`,
          };

  const gamma: FilterVerdict =
    row.regime === null
      ? {
          state: 'unknown',
          detail:
            'no chain was pulled for this name this morning, so its own dealer positioning was not measured',
        }
      : row.regime === 'positive'
        ? { state: 'pass', detail: 'its own dealer positioning reads positive' }
        : { state: 'fail', detail: 'its own dealer positioning reads negative' };

  const spy: FilterVerdict =
    market.spyRegime === null
      ? { state: 'unknown', detail: 'the SPY chain did not answer, so the market regime is unmeasured' }
      : market.spyRegime === 'positive'
        ? { state: 'pass', detail: "the wider market's dealer positioning reads positive" }
        : { state: 'fail', detail: "the wider market's dealer positioning reads negative" };

  const liquidity: FilterVerdict =
    m.avgDollarVolume > 0
      ? m.avgDollarVolume >= settings.minDollarVolume
        ? {
            state: 'pass',
            detail: `${fmtDollars(m.avgDollarVolume)} a day in shares`,
          }
        : {
            state: 'fail',
            detail: `${fmtDollars(m.avgDollarVolume)} a day, under the ${fmtDollars(settings.minDollarVolume)} floor`,
          }
      : { state: 'unknown', detail: 'no turnover reading' };

  return {
    rs,
    trend: trendVerdict,
    volume,
    vwap,
    gamma,
    spy,
    liquidity,
    contract: contractVerdict(row, settings),
  };
}

/** The four trend readings, spelled out, for the detail beside the number. */
export function describeTrendParts(trend: TrendScore): string {
  const { parts } = trend;
  const say = (value: boolean | null, yes: string, no: string) =>
    value === null ? null : value ? yes : no;

  const items = [
    say(parts.above50, 'above its 50-day', 'below its 50-day'),
    say(parts.above200, 'above its 200-day', 'below its 200-day'),
    say(parts.goldenOrder, '50 above 200', '50 below 200'),
    parts.m1Percentile === null
      ? null
      : `1-month return in the ${ordinal(Math.round(parts.m1Percentile))} percentile`,
  ].filter((item): item is string => item !== null);

  return items.length > 0 ? items.join(', ') : 'nothing measurable';
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * The contract filter.
 *
 * ## Not checked is grey, not red
 *
 * The chain provider answers a limited number of requests a day and the
 * morning gamma job has first call on them, so only the top names by score are
 * graded. Everything below that has an *unknown* contract. It is not dropped
 * and it is not marked as failing, because it was never tested; it renders
 * grey and says so, exactly as an unknown earnings date does.
 *
 * It filters and it does not score — see the note on `RULE_KEYS`. A name is
 * never pushed down the ranking for a chain nobody had budget to pull.
 */
function contractVerdict(row: ScanRow, settings: FilterSettings): FilterVerdict {
  const quality = row.optionQuality;

  if (!quality) {
    return { state: 'unknown', detail: 'contract not checked' };
  }
  if (quality.badge === 'unknown' || !quality.contract) {
    return {
      state: 'unknown',
      detail: quality.reasons[0] ?? 'the contract could not be graded',
    };
  }

  const c = quality.contract;
  const reasons: string[] = [];

  if (c.dte < settings.dteMin || c.dte > settings.dteMax) {
    reasons.push(
      `${c.dte} days to expiry, outside the ${settings.dteMin}-${settings.dteMax} window`,
    );
  }
  if (c.delta === null) {
    // Unknown delta cannot fail a delta window. It is reported and the window
    // is not applied, rather than being read as out of range.
    reasons.push('delta could not be modelled');
  } else if (c.delta < settings.deltaMin || c.delta > settings.deltaMax) {
    reasons.push(
      `delta ${c.delta.toFixed(2)}, outside ${settings.deltaMin.toFixed(2)}-${settings.deltaMax.toFixed(2)}`,
    );
  }
  if (quality.badge === 'caution' || quality.badge === 'avoid') {
    reasons.push(`the contract graded ${quality.badge}`);
  }

  if (reasons.length > 0) {
    return { state: 'fail', detail: reasons.join('; ') };
  }

  return {
    state: 'pass',
    detail: `${c.dte}d, delta ${c.delta === null ? 'unknown' : c.delta.toFixed(2)}, graded ${quality.badge}`,
  };
}

/**
 * Whether an upcoming report excludes a name, at the reader's buffer.
 *
 * Reads `state` and not `daysAway`, which is the rule the earnings type exists
 * to enforce: an unknown date is never "no earnings soon". An unknown date
 * keeps the name, with the uncertainty on its watch line.
 */
export function excludedByEarnings(row: ScanRow, bufferDays: number): boolean {
  return excludedForEarnings(row.earnings, bufferDays);
}

// --- the scored, judged, ordered list ----------------------------------------

export interface ScoredRow {
  row: ScanRow;
  score: RowScore;
  verdicts: Record<RuleKey, FilterVerdict>;
  /** Filters that are enabled and did not come back `pass`, in display order. */
  failing: RuleKey[];
  /** True when every *enabled* filter passed. `unknown` is not a pass. */
  passes: boolean;
  /** Phrase naming what stopped it. Empty when nothing did. */
  failingLabel: string;
  /** Set when an upcoming report removes it at the reader's buffer. */
  earningsExcluded: boolean;
}

export function scoreAndJudge(
  rows: ScanRow[],
  settings: FilterSettings,
  market: MarketContext,
  weights: ScoreWeights = SCORE_WEIGHTS,
): ScoredRow[] {
  return rows
    .map((row) => {
      const verdicts = ruleVerdicts(row, settings, market);
      const failing = RULE_KEYS.filter(
        (key) => settings.enabled[key] && verdicts[key].state !== 'pass',
      );

      return {
        row,
        score: scoreRow(row, market, weights),
        verdicts,
        failing,
        passes: failing.length === 0,
        failingLabel: failing
          .map((key) => `${RULE_LABEL[key]} (${verdicts[key].detail})`)
          .join('; '),
        earningsExcluded: excludedByEarnings(row, settings.earningsBufferDays),
      };
    })
    .sort(byScoreThenSymbol);
}

/**
 * Score descending, then symbol, so the order is total and stable.
 *
 * Ties are common and an unstable sort would reshuffle the list on every
 * slider tick for no reason the reader could see.
 */
function byScoreThenSymbol(a: ScoredRow, b: ScoredRow): number {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;
  return a.row.symbol.localeCompare(b.row.symbol);
}

// --- the funnel --------------------------------------------------------------

/**
 * Where the matching set narrows, stage by stage.
 *
 * The counts are cumulative and in the order a reader would ask them, and each
 * stage is clickable on the page. Every stage counts names that cleared *this
 * stage and all before it*, so they are monotonically non-increasing by
 * construction and the arithmetic is checkable by eye. A disabled filter is
 * not a stage — it is omitted from the strip rather than shown as a step
 * nothing fell out of.
 *
 * Reaching zero here is now a fact about the filters rather than a blank page:
 * the table underneath still renders the top of the ranking.
 */
export interface FunnelStage {
  key: 'scanned' | RuleKey | 'earnings';
  label: string;
  count: number;
  /** Names that reached this stage, for the click-to-filter. */
  symbols: string[];
}

/** The order the stages are asked in. */
export const FUNNEL_ORDER: RuleKey[] = [
  'rs',
  'trend',
  'volume',
  'vwap',
  'gamma',
  'spy',
  'liquidity',
  'contract',
];

export function buildFunnel(
  scored: ScoredRow[],
  settings: FilterSettings,
): FunnelStage[] {
  const stages: FunnelStage[] = [
    {
      key: 'scanned',
      label: 'scanned',
      count: scored.length,
      symbols: scored.map((s) => s.row.symbol),
    },
  ];

  let alive = scored;

  for (const key of FUNNEL_ORDER) {
    if (!settings.enabled[key]) continue;
    alive = alive.filter((s) => s.verdicts[key].state === 'pass');
    stages.push({
      key,
      label: FUNNEL_STAGE_LABEL[key](settings),
      count: alive.length,
      symbols: alive.map((s) => s.row.symbol),
    });
  }

  // Earnings last, and always present: it is not one of the filters and it is
  // not switchable off, but it removes names from the matching set and a
  // funnel that hid that would not add up against the list underneath it.
  alive = alive.filter((s) => !s.earningsExcluded);
  stages.push({
    key: 'earnings',
    label: `clear of earnings (${settings.earningsBufferDays}d)`,
    count: alive.length,
    symbols: alive.map((s) => s.row.symbol),
  });

  return stages;
}

const FUNNEL_STAGE_LABEL: Record<RuleKey, (s: FilterSettings) => string> = {
  rs: (s) => `cleared RS ${s.rsMin}`,
  trend: (s) => `trend ${s.trendMin}+`,
  volume: (s) => `volume ${s.volumeMult.toFixed(2)}x`,
  vwap: () => 'above daily VWAP',
  gamma: () => 'own gamma positive',
  spy: () => 'market gamma positive',
  liquidity: (s) => `liquid ${fmtDollars(s.minDollarVolume)}`,
  contract: () => 'contract OK',
};

/**
 * The market regime, as a sentence.
 *
 * It is also one of the seven scoring components and one of the eight filters,
 * but it is stated here in words because a reader needs to know it once, in
 * plain English, before reading anything below it. It used to be a per-name
 * gate, which was a category error with a real cost: one market-wide condition
 * failing identically for all 503 names blanked the page on volatile mornings.
 */
export const MARKET_REGIME_NOTE = {
  positive:
    'The wider market is calm — dealer hedging is damping moves rather than amplifying them.',
  negative:
    'The wider market is volatile — dealer hedging amplifies moves rather than damping them. Every name below is worth reading with that in mind.',
  unknown:
    "The market regime could not be read — the SPY chain did not answer. This is not a calm reading and it is not a volatile one; nobody measured it.",
} as const;
