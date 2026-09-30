import type { FredObservation } from '../types';
import type {
  DriverState,
  RichBiasDirection,
  RichBiasLabel,
  RichMacroBias,
  RichMacroDriver,
} from './types';

/**
 * The −5…+5 Macro Bias scorer.
 *
 * Pure and free of `server-only` so `scripts/verify-macro-bias-rich.js` can
 * exercise it against fixed FRED rows — each driver has a flat band and a sign,
 * the kind of logic that yields a confident, wrong label if a comparison is
 * inverted.
 *
 * Five standing drivers — rates, dollar, volatility, breadth, credit — each
 * score +1 when they favour risk assets, −1 against, 0 neutral, plus an
 * optional sixth (event risk) that is a headwind when a high-importance event
 * is inside a day and neutral otherwise. The bias is their sum, clamped −5…+5.
 * Confidence is separate: how one-sided the non-neutral drivers are, not how
 * far the score reached.
 */

function stateOf(score: -1 | 0 | 1): DriverState {
  return score > 0 ? 'tailwind' : score < 0 ? 'headwind' : 'neutral';
}

function last(series: FredObservation[]): FredObservation | null {
  return series.length > 0 ? series[series.length - 1] : null;
}

function driver(
  key: string,
  label: string,
  value: string,
  sub: string,
  score: -1 | 0 | 1,
): RichMacroDriver {
  return { key, label, value, sub, score, state: stateOf(score) };
}

const UNAVAILABLE = (key: string, label: string): RichMacroDriver =>
  driver(key, label, '—', 'No reading → neutral', 0);

/**
 * Rates — the 10-year yield. Falling is a tailwind (cheaper money, higher
 * valuations), rising a headwind; a move inside `flatPp` is flat.
 */
export function scoreRates(series: FredObservation[], flatPp: number): RichMacroDriver {
  const latest = last(series);
  const prior = series[series.length - 2] ?? latest;
  if (!latest || !prior) return UNAVAILABLE('rates', 'Rates (10Y)');
  const delta = latest.value - prior.value;
  const value = `10Y ${latest.value.toFixed(2)}%`;
  if (Math.abs(delta) < flatPp) return driver('rates', 'Rates (10Y)', value, `Flat (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pt) → neutral`, 0);
  return delta < 0
    ? driver('rates', 'Rates (10Y)', value, `Falling (${delta.toFixed(2)} pt) → tailwind`, 1)
    : driver('rates', 'Rates (10Y)', value, `Rising (+${delta.toFixed(2)} pt) → headwind`, -1);
}

/**
 * Dollar — the broad trade-weighted index. A softer dollar is risk-on (+1), a
 * firmer one risk-off (−1); a daily move inside `flatPct` is flat.
 */
export function scoreDollar(series: FredObservation[], flatPct: number): RichMacroDriver {
  const latest = last(series);
  const prior = series[series.length - 2] ?? latest;
  if (!latest || !prior || !(prior.value > 0)) return UNAVAILABLE('dollar', 'Dollar');
  const pct = ((latest.value - prior.value) / prior.value) * 100;
  const value = `DXY-broad ${latest.value.toFixed(1)}`;
  if (Math.abs(pct) < flatPct) return driver('dollar', 'Dollar', value, `Flat (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) → neutral`, 0);
  return pct < 0
    ? driver('dollar', 'Dollar', value, `Softening (${pct.toFixed(2)}%) → tailwind`, 1)
    : driver('dollar', 'Dollar', value, `Firming (+${pct.toFixed(2)}%) → headwind`, -1);
}

/**
 * Volatility — the VIX level. Calm (below `calm`) is a tailwind, stressed
 * (above `stress`) a headwind, in between neutral.
 */
export function scoreVol(series: FredObservation[], calm: number, stress: number): RichMacroDriver {
  const latest = last(series);
  if (!latest) return UNAVAILABLE('vol', 'Volatility');
  const value = `VIX ${latest.value.toFixed(1)}`;
  if (latest.value < calm) return driver('vol', 'Volatility', value, 'Calm tape → tailwind', 1);
  if (latest.value > stress) return driver('vol', 'Volatility', value, 'Stress rising → headwind', -1);
  return driver('vol', 'Volatility', value, 'Middling → neutral', 0);
}

/**
 * Credit — the high-yield option-adjusted spread. Tightening (falling) is a
 * tailwind, widening (rising) a headwind; a daily move inside `flatPp` is flat.
 */
export function scoreCredit(series: FredObservation[], flatPp: number): RichMacroDriver {
  const latest = last(series);
  const prior = series[series.length - 2] ?? latest;
  if (!latest || !prior) return UNAVAILABLE('credit', 'Credit');
  const delta = latest.value - prior.value;
  const value = `HY OAS ${latest.value.toFixed(2)}%`;
  if (Math.abs(delta) < flatPp) return driver('credit', 'Credit', value, `Stable (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pt) → neutral`, 0);
  return delta < 0
    ? driver('credit', 'Credit', value, `Tightening (${delta.toFixed(2)} pt) → tailwind`, 1)
    : driver('credit', 'Credit', value, `Widening (+${delta.toFixed(2)} pt) → headwind`, -1);
}

/**
 * Breadth — share of the index above yesterday's close, from the internal
 * reading. Broad participation is a tailwind, a narrow tape a headwind.
 */
export function scoreBreadth(pctAbovePriorClose: number | null): RichMacroDriver {
  if (pctAbovePriorClose === null) return UNAVAILABLE('breadth', 'Breadth');
  const value = `${Math.round(pctAbovePriorClose)}% > prior`;
  if (pctAbovePriorClose > 55) return driver('breadth', 'Breadth', value, 'Broad participation → tailwind', 1);
  if (pctAbovePriorClose < 45) return driver('breadth', 'Breadth', value, 'Narrow tape → headwind', -1);
  return driver('breadth', 'Breadth', value, 'Mixed participation → neutral', 0);
}

/**
 * Event risk — the optional sixth driver. A high-importance event inside a day
 * is a headwind on conviction; otherwise neutral. Never a tailwind.
 */
export function scoreEvent(eventLabel: string | null): RichMacroDriver {
  if (eventLabel) return driver('event', 'Event risk', `${eventLabel} <24h`, 'Scheduled catalyst inside a day → headwind', -1);
  return driver('event', 'Event risk', 'None <24h', 'No catalyst inside a day → neutral', 0);
}

function labelFor(score: number): { label: RichBiasLabel; direction: RichBiasDirection } {
  if (score >= 3) return { label: 'Bullish', direction: 'bullish' };
  if (score >= 1) return { label: 'Cautiously bullish', direction: 'bullish' };
  if (score === 0) return { label: 'Neutral', direction: 'neutral' };
  if (score >= -2) return { label: 'Cautiously bearish', direction: 'bearish' };
  return { label: 'Bearish', direction: 'bearish' };
}

/** How one-sided the non-neutral drivers are, 0–100. Independent of direction. */
function confidenceOf(drivers: RichMacroDriver[], score: number): number {
  const sign = Math.sign(score);
  if (sign === 0) return 30; // a flat net with mixed drivers is inherently low-conviction
  const signed = drivers.filter((d) => d.score !== 0);
  if (signed.length === 0) return 30;
  const agreeing = signed.filter((d) => Math.sign(d.score) === sign).length;
  return Math.round((agreeing / signed.length) * 100);
}

/** A plain-language one-liner naming the leading side. */
function reasonFor(drivers: RichMacroDriver[], score: number): string {
  const headwinds = drivers.filter((d) => d.state === 'headwind').map((d) => d.label.toLowerCase());
  const tailwinds = drivers.filter((d) => d.state === 'tailwind').map((d) => d.label.toLowerCase());
  const list = (xs: string[]) =>
    xs.length === 0 ? '' : xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

  if (score < 0) {
    const lead = list(headwinds) || 'the macro backdrop';
    const relief = tailwinds.length ? ` while ${list(tailwinds)} ${tailwinds.length === 1 ? 'is' : 'are'} supportive` : '';
    return `${lead.charAt(0).toUpperCase()}${lead.slice(1)} ${headwinds.length === 1 ? 'is' : 'are'} leaning against risk${relief} — macro context, not a warning.`;
  }
  if (score > 0) {
    const lead = list(tailwinds) || 'the macro backdrop';
    const drag = headwinds.length ? ` despite ${list(headwinds)}` : '';
    return `${lead.charAt(0).toUpperCase()}${lead.slice(1)} ${tailwinds.length === 1 ? 'is' : 'are'} supportive of risk${drag} — macro context, not a green light.`;
  }
  return 'The macro drivers are pulling in both directions and roughly cancel — a mixed backdrop, not a signal.';
}

export interface RichThresholds {
  tenYearFlatPp: number;
  dollarFlatPct: number;
  creditFlatPp: number;
  vixCalm: number;
  vixStress: number;
}

export interface RichInputs {
  tenYear: FredObservation[];
  dollar: FredObservation[];
  vix: FredObservation[];
  credit: FredObservation[];
  breadthPct: number | null;
  /** The next high-importance catalyst inside 24h, or null. */
  imminentEventLabel: string | null;
  /** The next scheduled catalyst's label (any importance), for history. */
  nextEventLabel: string;
}

export function computeRichMacroBias(
  inputs: RichInputs,
  thresholds: RichThresholds,
  dateKey: string,
  at: string,
): RichMacroBias {
  const drivers: RichMacroDriver[] = [
    scoreRates(inputs.tenYear, thresholds.tenYearFlatPp),
    scoreDollar(inputs.dollar, thresholds.dollarFlatPct),
    scoreVol(inputs.vix, thresholds.vixCalm, thresholds.vixStress),
    scoreBreadth(inputs.breadthPct),
    scoreCredit(inputs.credit, thresholds.creditFlatPp),
    scoreEvent(inputs.imminentEventLabel),
  ];

  const raw = drivers.reduce((sum, d) => sum + d.score, 0);
  const score = Math.max(-5, Math.min(5, raw));
  const { label, direction } = labelFor(score);

  return {
    score,
    label,
    direction,
    confidence: confidenceOf(drivers, score),
    drivers,
    reason: reasonFor(drivers, score),
    // Set by the refresh once the previous reading is known (see index.ts).
    changed: '',
    nextEventLabel: inputs.nextEventLabel,
    at,
    dateKey,
  };
}

/** What flipped between two readings, as a history line. */
export function changedLine(current: RichMacroBias, previous: RichMacroBias | null): string {
  if (!previous) return 'First reading tracked';
  const flips: string[] = [];
  for (const d of current.drivers) {
    const was = previous.drivers.find((p) => p.key === d.key);
    if (was && was.state !== d.state) {
      flips.push(`${d.label} → ${d.state}`);
    }
  }
  if (flips.length === 0) return 'No driver changes';
  return flips.slice(0, 2).join('; ');
}
