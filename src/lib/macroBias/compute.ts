import type {
  BiasLabel,
  FactorDirection,
  FredObservation,
  MacroBias,
  MacroFactor,
} from './types';

/**
 * The Macro Bias scorer.
 *
 * Pure and free of `server-only` so `scripts/verify-macro-bias.js` can exercise
 * it against known FRED rows — the three factors each have a "flat" band and a
 * sign, exactly the kind of logic that yields a confident, wrong label if a
 * comparison is inverted, so it is worth asserting on directly.
 *
 * Each factor scores +1 when it favours stocks going up, −1 when it works
 * against them, 0 when neutral. Bias is the sum, −3…+3.
 */

const DAY_MS = 86_400_000;

/** Most recent observation on or before `date`. */
function asOf(series: FredObservation[], date: string): FredObservation | null {
  let found: FredObservation | null = null;
  for (const o of series) {
    if (o.date > date) break;
    found = o;
  }
  return found;
}

function directionOf(score: -1 | 0 | 1): FactorDirection {
  if (score > 0) return 'bullish';
  if (score < 0) return 'bearish';
  return 'neutral';
}

export interface ScoreThresholds {
  fedLookbackDays: number;
  tenYearFlatPp: number;
  cpiFlatPp: number;
}

/**
 * Fed: a cut (rate falling vs the print `fedLookbackDays` ago) is +1, a hike is
 * −1, unchanged is 0. Day-over-day would read "steady" almost every day, so the
 * comparison reaches back to catch the last policy move.
 */
function scoreFed(series: FredObservation[], lookbackDays: number): MacroFactor {
  const latest = series[series.length - 1];
  const priorDate = new Date(Date.parse(latest.date) - lookbackDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const prior = asOf(series, priorDate) ?? series[0];
  const delta = latest.value - prior.value;

  let score: -1 | 0 | 1;
  let sub: string;
  if (delta < 0) {
    score = 1;
    sub = `Cutting (was ${prior.value.toFixed(2)}%) → tailwind`;
  } else if (delta > 0) {
    score = -1;
    sub = `Hiking (was ${prior.value.toFixed(2)}%) → headwind`;
  } else {
    score = 0;
    sub = 'Steady → neutral';
  }

  return {
    value: `${latest.value.toFixed(2)}%`,
    sub,
    score,
    direction: directionOf(score),
  };
}

/**
 * 10-year: yields falling is +1 (cheaper money, higher valuations), rising is
 * −1, a move inside `flatPp` is flat. Day-over-day, per spec.
 */
function scoreTenYear(series: FredObservation[], flatPp: number): MacroFactor {
  const latest = series[series.length - 1];
  const prior = series[series.length - 2] ?? latest;
  const delta = latest.value - prior.value;

  let score: -1 | 0 | 1;
  let sub: string;
  if (Math.abs(delta) < flatPp) {
    score = 0;
    sub = `Flat (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pt) → neutral`;
  } else if (delta < 0) {
    score = 1;
    sub = `Falling (${delta.toFixed(2)} pt) → tailwind`;
  } else {
    score = -1;
    sub = `Rising (+${delta.toFixed(2)} pt) → headwind`;
  }

  return {
    value: `${latest.value.toFixed(2)}%`,
    sub,
    score,
    direction: directionOf(score),
  };
}

/** Year-over-year percent from an index level and the level 12 months earlier. */
function yoy(series: FredObservation[], monthsBack: number): number | null {
  if (series.length <= monthsBack) return null;
  const latest = series[series.length - 1];
  const past = series[series.length - 1 - monthsBack];
  if (!past || !(past.value > 0)) return null;
  return (latest.value / past.value - 1) * 100;
}

/**
 * CPI: inflation cooling versus the prior month's year-over-year rate is +1,
 * sticky or re-accelerating is −1, a change inside `flatPp` is flat. Both the
 * current and prior YoY are computed from the monthly index so the comparison
 * is like-for-like.
 */
function scoreCpi(series: FredObservation[], flatPp: number): MacroFactor {
  // Current YoY: latest month vs 12 months earlier.
  const nowYoy = yoy(series, 12);
  // Prior YoY: the month before, vs 12 months before that — i.e. drop the last
  // observation and repeat.
  const priorYoy = yoy(series.slice(0, -1), 12);

  if (nowYoy === null) {
    return {
      value: '—',
      sub: 'No reading → neutral',
      score: 0,
      direction: 'neutral',
    };
  }

  const value = `${nowYoy.toFixed(1)}% YoY`;

  if (priorYoy === null) {
    return { value, sub: 'No prior month → neutral', score: 0, direction: 'neutral' };
  }

  const delta = nowYoy - priorYoy;
  let score: -1 | 0 | 1;
  let sub: string;
  if (Math.abs(delta) < flatPp) {
    score = 0;
    sub = `Flat (was ${priorYoy.toFixed(1)}%) → neutral`;
  } else if (delta < 0) {
    score = 1;
    sub = `Cooling (from ${priorYoy.toFixed(1)}%) → tailwind`;
  } else {
    score = -1;
    sub = `Sticky (from ${priorYoy.toFixed(1)}%) → headwind`;
  }

  return { value, sub, score, direction: directionOf(score) };
}

function labelFor(score: number): { label: BiasLabel; direction: FactorDirection } {
  if (score >= 2) return { label: 'Bullish', direction: 'bullish' };
  if (score === 1) return { label: 'Mild up', direction: 'bullish' };
  if (score === 0) return { label: 'Flat', direction: 'neutral' };
  if (score === -1) return { label: 'Mild down', direction: 'bearish' };
  return { label: 'Bearish', direction: 'bearish' };
}

/**
 * A one-line, plain-language read of the three factors together — the footer
 * under the box. Names each factor's state, then the net effect on SPY.
 */
function footerFor(fed: MacroFactor, tenYear: MacroFactor, cpi: MacroFactor, score: number): string {
  const rates =
    fed.score < 0 || tenYear.score < 0
      ? 'Rates rising'
      : fed.score > 0 || tenYear.score > 0
        ? 'Rates easing'
        : 'Rates steady';
  const inflation =
    cpi.score < 0 ? 'inflation stuck' : cpi.score > 0 ? 'inflation cooling' : 'inflation flat';
  const net =
    score > 0 ? 'tailwind for SPY' : score < 0 ? 'headwind for SPY' : 'mixed for SPY';
  return `${rates}, ${inflation} → ${net}.`;
}

export function computeMacroBias(
  fedSeries: FredObservation[],
  tenYearSeries: FredObservation[],
  cpiSeries: FredObservation[],
  thresholds: ScoreThresholds,
  at: string,
): MacroBias {
  const fed = scoreFed(fedSeries, thresholds.fedLookbackDays);
  const tenYear = scoreTenYear(tenYearSeries, thresholds.tenYearFlatPp);
  const cpi = scoreCpi(cpiSeries, thresholds.cpiFlatPp);

  const score = fed.score + tenYear.score + cpi.score;
  const { label, direction } = labelFor(score);

  return {
    score,
    label,
    direction,
    fed,
    tenYear,
    cpi,
    footer: footerFor(fed, tenYear, cpi, score),
    at,
  };
}
