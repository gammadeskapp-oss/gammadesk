/**
 * Scoring, rule verdicts, and the funnel — the whole of the scanner's
 * judgement, in one client-safe, dependency-free file.
 *
 * ## Why this is not `evaluate.ts`
 *
 * `evaluate.ts` turned *stored verdicts* into sentences. The verdicts were
 * resolved once, on the server, at scan time, against thresholds baked into
 * the run. That is exactly what has to stop: the reader now owns the
 * thresholds, and moving one has to re-decide every row instantly and without
 * touching the network. So nothing here reads a stored verdict. Everything is
 * derived from `ScanRow.metrics` — the raw readings — against a
 * `FilterSettings` the reader controls.
 *
 * The practical consequence is the constraint this file exists to enforce: the
 * server stores *numbers*, never conclusions. A stored `pass` would be a
 * conclusion drawn at one setting and rendered under another.
 *
 * ## Ranking is not recommending
 *
 * The scan used to AND five gates together and print whatever survived. Twice
 * in a row that was nothing out of 503, and an empty page is a dead page — it
 * cannot even tell you which rule ate the list. So the five components are now
 * scored and summed, the list is always ordered, and the top of it is always
 * rendered.
 *
 * This must not be read as a softening. A name that fails a rule still fails
 * it, its badge is still red, and it is dimmed on the page. What changed is
 * that failing a rule no longer makes a name *invisible* — because "nothing
 * passed" and "these are the closest things to passing, and here is what each
 * of them failed" are answers of enormously different value, and the second
 * one is the honest one.
 */

import { excludedForEarnings } from './earningsRules';
import {
  OPTION_WINDOW,
  RULE_KEYS,
  RULE_LABEL,
  type FilterVerdict,
  type OptionQualityBadge,
  type RuleKey,
  type ScanRow,
} from './types';

// --- the weights -------------------------------------------------------------

export interface ScoreWeights {
  rs: number;
  trend: number;
  volume: number;
  liquidity: number;
  contract: number;
}

/**
 * What each component is worth in the composite, before renormalisation.
 *
 * One object, at the top of the file, because these will be argued about and
 * the argument should cost one edit. They do not have to sum to anything —
 * `scoreRow` renormalises over the components a given name actually has.
 *
 * The shape of them is the claim being made: relative strength is the largest
 * single input because it is the reading this whole page is built around and
 * the one the reader can go and check on /strength. Liquidity is the smallest
 * because it is close to a floor rather than a gradient — the difference
 * between $400M and $4bn a day does not matter to anyone trading retail size,
 * while the difference between $8M and $80M very much does, which is what the
 * log scaling below is for.
 */
export const SCORE_WEIGHTS: ScoreWeights = {
  rs: 0.35,
  trend: 0.2,
  volume: 0.2,
  liquidity: 0.1,
  contract: 0.15,
};

// --- the reader's settings ---------------------------------------------------

/**
 * Every threshold the page exposes, and the on/off switch for each rule.
 *
 * Serialised into the query string, so a configuration can be bookmarked and
 * sent to someone else — see `filterState.ts`. Nothing here reaches the
 * server: it is applied to the cached snapshot in the browser.
 */
export interface FilterSettings {
  /** Composite relative-strength score a name must clear. */
  rsMin: number;
  /** Recent volume as a multiple of the name's own baseline. */
  volumeMult: number;
  /** Average daily dollar turnover floor. */
  minDollarVolume: number;
  /**
   * Percent above the 200-day average.
   *
   * Allowed to go negative, deliberately. "Within 3% below its 200-day" is a
   * coherent thing to look for, and a slider that stopped at zero would be
   * quietly asserting that it is not.
   */
  trendPct: number;
  /** Days to expiry the contract check looks in. */
  dteMin: number;
  dteMax: number;
  deltaMin: number;
  deltaMax: number;
  /** Calendar days inside which an upcoming report excludes a name. */
  earningsBufferDays: number;
  /** Which of the five rules are switched on. */
  enabled: Record<RuleKey, boolean>;
  /**
   * Whether to hide names when the wider market is in a volatile regime.
   *
   * Off by default, and it is the only market-wide control on the page. See
   * `MARKET_REGIME_NOTE` and the banner: the regime used to be a sixth
   * per-name rule, which meant that on a volatile morning all 503 names died
   * at the same step and the page went blank for a reason that had nothing to
   * do with any of them.
   */
  requireCalmMarket: boolean;
}

/**
 * The shipped defaults — the rule set exactly as it stood before this page
 * could be adjusted.
 *
 * This matters more than it looks. The controls open on these values, so the
 * first thing the reader sees is the old scan's answer, and every change they
 * make is visibly a change *from* something rather than a configuration
 * assembled out of nothing.
 */
export const DEFAULT_FILTERS: FilterSettings = {
  rsMin: 90,
  volumeMult: 1,
  // The equity `HIGH` tier cutoff from `config.tradeability`, which is what
  // the liquidity gate used to require.
  minDollarVolume: 250_000_000,
  trendPct: 0,
  dteMin: OPTION_WINDOW.minDte,
  dteMax: OPTION_WINDOW.maxDte,
  deltaMin: OPTION_WINDOW.minDelta,
  deltaMax: OPTION_WINDOW.maxDelta,
  earningsBufferDays: 10,
  enabled: { rs: true, ema: true, volume: true, liquidity: true, contract: true },
  requireCalmMarket: false,
};

/** Slider bounds, kept here so the controls and the clamping cannot disagree. */
export const FILTER_BOUNDS = {
  rsMin: { min: 50, max: 99, step: 1 },
  volumeMult: { min: 1, max: 3, step: 0.05 },
  minDollarVolume: { min: 10_000_000, max: 1_000_000_000, step: 10_000_000 },
  trendPct: { min: -20, max: 40, step: 1 },
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
    volumeMult: clamp(s.volumeMult, b.volumeMult.min, b.volumeMult.max),
    minDollarVolume: clamp(
      s.minDollarVolume,
      b.minDollarVolume.min,
      b.minDollarVolume.max,
    ),
    trendPct: clamp(s.trendPct, b.trendPct.min, b.trendPct.max),
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
 * What each option-quality badge is worth.
 *
 * `unknown` and "not checked" are deliberately absent — they are not scored at
 * all. See `scoreRow`: an ungraded contract removes the component and its
 * weight rather than contributing a zero, because a zero would push a name
 * down the list for something nobody measured.
 */
const CONTRACT_POINTS: Partial<Record<OptionQualityBadge, number>> = {
  excellent: 100,
  tradable: 75,
  caution: 35,
  avoid: 0,
};

export interface ScoreComponents {
  /** Null where the reading is missing, which removes it from the blend. */
  rs: number | null;
  trend: number | null;
  volume: number | null;
  liquidity: number | null;
  contract: number | null;
}

export interface RowScore {
  /** 0-100. */
  total: number;
  components: ScoreComponents;
  /** Components that had no reading, so the blend can be reported honestly. */
  missing: Array<keyof ScoreComponents>;
}

/**
 * One name's composite, 0-100.
 *
 * ## Missing readings shrink the blend, they do not score zero
 *
 * This is the same rule the earnings logic has always applied, moved somewhere
 * else it matters. A name whose contract was never checked has an unknown
 * contract, not a bad one, and scoring the unknown as zero would rank it below
 * a name graded `Avoid` — which would be a statement about the data pipeline
 * dressed up as a statement about the stock. So an absent component is dropped
 * and the remaining weights are renormalised over what is left.
 *
 * The visible consequence is that ranking and grading are circular: only the
 * top N have contracts checked (see `OPTION_QUALITY_TOP_N`), and the contract
 * is a scoring component. The scan resolves this by scoring the four cheap
 * components first, grading the top of *that* order, then rescoring. Names can
 * therefore move a place or two once graded, and the page says so rather than
 * hiding it behind a single final number.
 */
export function scoreRow(row: ScanRow, weights: ScoreWeights = SCORE_WEIGHTS): RowScore {
  const m = row.metrics;

  const components: ScoreComponents = {
    // Already a 0-100 percentile composite. Used as-is: rescaling a score the
    // reader can look up on /strength would make the two pages disagree.
    rs: Number.isFinite(m.rsScore) ? Math.min(100, Math.max(0, m.rsScore)) : null,

    // -20% to +40% above the 200-day. Below the average is not zero — a name
    // 2% under is a different situation from one 20% under, and flattening
    // both to nothing would throw away the ordering at the interesting end.
    trend: m.pctAbove200 === null ? null : ramp(m.pctAbove200, -20, 40),

    // 0.5x to 2.5x its own baseline. 1.0 — the confirmation line — lands at 25,
    // so merely confirmed is a low score and heavy participation is a high one.
    volume: m.volumeRatio === null ? null : ramp(m.volumeRatio, 0.5, 2.5),

    // Log scale, $10M to $10bn a day. Linear would put every megacap at 100
    // and every ordinary name near zero, which measures index membership
    // rather than tradeability.
    liquidity:
      m.avgDollarVolume > 0
        ? ramp(Math.log10(m.avgDollarVolume), 7, 10)
        : null,

    contract:
      row.optionQuality === null
        ? null
        : CONTRACT_POINTS[row.optionQuality.badge] ?? null,
  };

  let weighted = 0;
  let totalWeight = 0;
  const missing: Array<keyof ScoreComponents> = [];

  for (const key of Object.keys(components) as Array<keyof ScoreComponents>) {
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
  };
}

// --- rule verdicts -----------------------------------------------------------

function fmtDollars(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}bn`;
  return `$${Math.round(v / 1e6)}M`;
}

/**
 * The five rules, resolved against the reader's settings.
 *
 * Always all five, always in `RULE_KEYS` order, never filtered and never
 * suppressed when the answer is red. A rule the reader has switched off still
 * returns its verdict — the caller renders it dimmed and stops counting it —
 * because a rule that vanishes when disabled takes its reading with it, and
 * the reading was the point.
 *
 * `unknown` is never a pass and never a fail. It is the third state the whole
 * scanner is built around: a name whose 200-day average could not be computed
 * has not fallen below it, and a contract nobody pulled a chain for has not
 * scored badly. See `types.ts`.
 */
export function ruleVerdicts(
  row: ScanRow,
  settings: FilterSettings,
): Record<RuleKey, FilterVerdict> {
  const m = row.metrics;

  const rs: FilterVerdict = Number.isFinite(m.rsScore)
    ? m.rsScore >= settings.rsMin
      ? { state: 'pass', detail: `RS ${m.rsScore.toFixed(0)}, at or above the ${settings.rsMin} cutoff` }
      : { state: 'fail', detail: `RS ${m.rsScore.toFixed(0)}, below the ${settings.rsMin} cutoff` }
    : { state: 'unknown', detail: 'no relative-strength reading' };

  const ema: FilterVerdict =
    m.pctAbove200 === null
      ? {
          state: 'unknown',
          detail:
            'fewer than 200 daily bars, so the long-term trend could not be read',
        }
      : m.pctAbove200 >= settings.trendPct
        ? {
            state: 'pass',
            detail: `${m.pctAbove200 >= 0 ? '' : '-'}${Math.abs(m.pctAbove200).toFixed(0)}% ${
              m.pctAbove200 >= 0 ? 'above' : 'below'
            } the 200-day average`,
          }
        : {
            state: 'fail',
            detail: `${Math.abs(m.pctAbove200).toFixed(0)}% ${
              m.pctAbove200 >= 0 ? 'above' : 'below'
            } the 200-day average, under the ${settings.trendPct}% cutoff`,
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

  return { rs, ema, volume, liquidity, contract: contractVerdict(row, settings) };
}

/**
 * The contract rule.
 *
 * ## Not checked is grey, not red
 *
 * The chain provider answers a limited number of requests a day and the
 * morning gamma job has first call on them, so only the top names by score are
 * graded — see `OPTION_QUALITY_TOP_N`. Everything below that has an *unknown*
 * contract. It is not dropped and it is not marked as failing, because it was
 * never tested; it renders grey and says so, exactly as an unknown earnings
 * date does.
 *
 * A graded contract is then checked against the reader's own DTE and delta
 * window as well as its badge, because the badge was computed against the
 * shipped window and the reader may have moved it.
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

// --- the scored, filtered, ordered list --------------------------------------

export interface ScoredRow {
  row: ScanRow;
  score: RowScore;
  verdicts: Record<RuleKey, FilterVerdict>;
  /** Rules that are enabled and did not come back `pass`, in display order. */
  failing: RuleKey[];
  /** True when every *enabled* rule passed. `unknown` is not a pass. */
  passes: boolean;
  /** Phrase naming what stopped it. Empty when nothing did. */
  failingLabel: string;
  /** Set when an upcoming report removes it at the reader's buffer. */
  earningsExcluded: boolean;
}

export function scoreAndJudge(
  rows: ScanRow[],
  settings: FilterSettings,
  weights: ScoreWeights = SCORE_WEIGHTS,
): ScoredRow[] {
  return rows
    .map((row) => {
      const verdicts = ruleVerdicts(row, settings);
      const failing = RULE_KEYS.filter(
        (key) => settings.enabled[key] && verdicts[key].state !== 'pass',
      );

      return {
        row,
        score: scoreRow(row, weights),
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
 * Ties are common — two names with no contract and the same RS band land on
 * the same number to several places — and an unstable sort would reshuffle the
 * list on every slider tick for no reason the reader could see.
 */
function byScoreThenSymbol(a: ScoredRow, b: ScoredRow): number {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;
  return a.row.symbol.localeCompare(b.row.symbol);
}

// --- the funnel --------------------------------------------------------------

/**
 * Where the list drops out, stage by stage.
 *
 * This is the piece that was missing. The old page ANDed five rules and
 * printed the survivors, so on a zero-result morning there was no way at all
 * to see *which* step ate the list — whether the market had no strong names,
 * or the option window was set somewhere nothing lives. The counts are
 * cumulative and in the order a reader would ask them, and each stage is
 * clickable on the page.
 *
 * Every stage counts names that cleared *this stage and all before it*, so
 * they are monotonically non-increasing by construction and the arithmetic is
 * checkable by eye. A disabled rule is not a stage — it is omitted from the
 * strip rather than shown as a step nothing fell out of.
 */
export interface FunnelStage {
  key: 'scanned' | RuleKey | 'earnings';
  label: string;
  count: number;
  /** Names that reached this stage, for the click-to-filter. */
  symbols: string[];
}

/** The order the stages are asked in. Trend first, because most names clear it. */
export const FUNNEL_ORDER: RuleKey[] = ['ema', 'rs', 'volume', 'liquidity', 'contract'];

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

  // Earnings last, and always present: it is not one of the five rules and it
  // is not switchable off, but it removes names and a funnel that hid that
  // would not add up against the list underneath it.
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
  ema: (s) =>
    s.trendPct === 0
      ? 'above 200-day'
      : `${s.trendPct > 0 ? '+' : ''}${s.trendPct}% vs 200-day`,
  rs: (s) => `cleared RS ${s.rsMin}`,
  volume: (s) => `volume ${s.volumeMult.toFixed(2)}x`,
  liquidity: (s) => `liquid ${fmtDollars(s.minDollarVolume)}`,
  contract: () => 'contract OK',
};

/**
 * The market regime, as a sentence rather than a rule.
 *
 * It used to be the fifth gate, evaluated per name. That was a category error
 * with a real cost: the regime is one market-wide condition, so on a volatile
 * morning it failed identically for all 503 names and the page went blank —
 * every day the market was volatile, regardless of what any individual name
 * was doing. A single banner says the same thing once, and the optional
 * `requireCalmMarket` toggle lets a reader who wants that behaviour back have
 * it, switched off by default.
 */
export const MARKET_REGIME_NOTE = {
  positive:
    'The wider market is calm — dealer hedging is damping moves rather than amplifying them.',
  negative:
    'The wider market is volatile — dealer hedging amplifies moves rather than damping them. Every name below is worth reading with that in mind.',
  unknown:
    "The market regime could not be read — the SPY chain did not answer. This is not a calm reading and it is not a volatile one; nobody measured it.",
} as const;
