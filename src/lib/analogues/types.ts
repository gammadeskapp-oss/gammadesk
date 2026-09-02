import type { Bar } from '../ticker/types';

export type { Bar };

/** The eight conditions. Ids are stable — they appear in URLs. */
export type ConditionId =
  | 'down-3' | 'down-4' | 'down-5'
  | 'up-3' | 'up-4' | 'up-5'
  | 'dd-3' | 'dd-5' | 'dd-10'
  | 'rsi-under-30' | 'rsi-over-70'
  | 'ma200-lost' | 'ma200-regained'
  | 'bb-lower'
  | 'gap-up-1' | 'gap-down-1';

export interface ConditionDef {
  id: ConditionId;
  /**
   * Group heading. There are exactly eight, one per condition in the brief;
   * several carry more than one threshold, which is why there are sixteen ids
   * and eight families.
   */
  family:
    | 'consecutive-down' | 'consecutive-up' | 'drawdown' | 'rsi'
    | 'ma200-lost' | 'ma200-regained' | 'bollinger' | 'gap';
  label: string;
  /** What fires it, in one line. Shown on the table. */
  rule: string;
  /**
   * Bars needed before the condition can fire at all. Used to state the
   * effective lookback, which is not the same as the first stored bar.
   */
  warmup: number;
}

/** Trading-day horizons. Fixed: the display is built around exactly these. */
export const HORIZONS = [1, 5, 10, 21, 42] as const;
export type Horizon = (typeof HORIZONS)[number];

/** One horizon's outcome for one match. */
export interface Outcome {
  horizon: Horizon;
  /** Close-to-close return over the window, as a fraction. */
  ret: number;
  /**
   * Deepest close below the entry close anywhere inside the window, as a
   * fraction (<= 0). Measured on closes, not intraday lows — the conditions
   * fire on closes and mixing the two would overstate the depth.
   */
  drawdown: number;
}

export interface Match {
  /** `YYYY-MM-DD` of the close that completed the condition. */
  date: string;
  /** Index into the bar series, for chart marking. */
  index: number;
  /** Close on the match date. */
  close: number;
  /**
   * Outcomes present only for horizons that have fully elapsed. A match 10
   * sessions from the end of history has a 1, 5 and 10 but no 21 or 42, and
   * is excluded from those rows rather than counted as flat.
   */
  outcomes: Outcome[];
  /**
   * True when this match sits inside an earlier anchor's 42-day window, so it
   * is not an independent observation. False makes it an anchor, and the
   * episode count is the number of anchors.
   */
  overlapsPrevious: boolean;
}

export interface HorizonStats {
  horizon: Horizon;
  /** Matches with this horizon fully elapsed. Differs per horizon. */
  n: number;
  medianReturn: number | null;
  bestReturn: number | null;
  worstReturn: number | null;
  /** Dates carrying the best and worst, so a single outlier is nameable. */
  bestDate: string | null;
  worstDate: string | null;
  /** Share of `n` that finished above zero, 0-100. */
  positivePct: number | null;
  medianDrawdown: number | null;
  worstDrawdown: number | null;
}

/** Everything the UI needs in order to refuse to overstate the sample. */
export interface Honesty {
  /** Under 10 matches: "pattern, not proof", medians greyed. */
  thin: boolean;
  /** Matches within 42 sessions of an earlier match. */
  overlapping: number;
  /**
   * Separate episodes the matches came from: runs of matches each within 42
   * sessions of the one before are one episode, however many matches they
   * contain. Exactly `matches.length - overlapping`, because a match that does
   * not overlap its predecessor is by definition the start of a new run.
   *
   * This is the plain-English form of the overlap count, and it is derived
   * rather than estimated.
   */
  episodes: number;
  /** Set when more than half the matches share one calendar year. */
  clusteredYear: { year: string; count: number } | null;
}

/**
 * What an unconditional window did over the same history, for comparison.
 *
 * Without this the tables imply an edge they have not demonstrated. SPY drifts
 * up over 33 years, so a +2.5% median at 42 days may be exactly what a window
 * picked at random does — in which case the condition added nothing, and only
 * the gap between the two rows says so.
 *
 * No significance test is computed. Both numbers are shown and the difference
 * is left to the reader.
 */
export interface BaselineStats {
  horizon: Horizon;
  /** Windows with this horizon fully elapsed — every eligible entry bar. */
  n: number;
  medianReturn: number | null;
  positivePct: number | null;
  medianDrawdown: number | null;
}

export interface ConditionResult {
  id: ConditionId;
  label: string;
  rule: string;
  family: ConditionDef['family'];
  matches: Match[];
  /** First and last match date. Null when there are no matches. */
  firstMatch: string | null;
  lastMatch: string | null;
  /** True when the most recent bar in the series is itself a match. */
  activeToday: boolean;
  horizons: HorizonStats[];
  honesty: Honesty;
}

export interface Coverage {
  symbol: string;
  source: 'yahoo' | 'polygon';
  bars: number;
  firstDate: string;
  lastDate: string;
  /** Calendar years spanned, one decimal. */
  years: number;
  /**
   * Sessions separated from the previous bar by more than five calendar days.
   * A market closure (September 2001) shows here as well as a real hole; the
   * page names the dates rather than asserting which it is.
   */
  gaps: { from: string; to: string; days: number }[];
  /** What the price field is adjusted for. See `deepBars.ts`. */
  adjustment: 'split-only' | 'split-and-dividend';
}

export interface AnaloguesView {
  coverage: Coverage;
  /**
   * Per-session regime, plus what each filter can and cannot reach. Index
   * aligned with the bar series, so a match knows its own regime by index.
   */
  regimes: import('./regimes').RegimeSeries;
  /**
   * One baseline per horizon, over the whole series. Computed once and shared
   * by every table: all sixteen conditions rest on the same lookback, so a
   * per-condition baseline would be the same numbers repeated sixteen times.
   */
  baseline: BaselineStats[];
  conditions: ConditionResult[];
  /** Ids currently firing on the last bar. Empty is a real answer. */
  active: ConditionId[];
}
