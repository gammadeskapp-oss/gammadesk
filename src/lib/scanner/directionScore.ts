/**
 * Direction-specific scoring for the Daily 20 — one Bullish Leader Score and
 * one Bearish Laggard Score per name, each a 0-100 blend of named components.
 *
 * ## Why this sits beside `score.ts` rather than inside it
 *
 * `score.ts` produces one composite that ranks the whole universe for the
 * existing scanner, and that page and its filters depend on it unchanged. The
 * Daily 20 asks a different question — "is this a leader?" and, separately, "is
 * this a laggard?" — so it needs two scores with their own weights and their
 * own component meanings. Keeping them here leaves the existing scanner's
 * numbers exactly as they were.
 *
 * ## Everything is a named constant and every component is always returned
 *
 * The weights are exported constants at the top of the file so they can be
 * tuned in one place. Each component is returned as a `number | null` — never
 * silently dropped — so the page can render the full breakdown beside every
 * total, which is a hard requirement: a score nobody can inspect is a number a
 * reader is being asked to trust. A `null` component is renormalised out of the
 * blend exactly as `score.ts` does, so a name with no chain is not punished for
 * the request budget.
 *
 * ## Two of the seven components arrive later
 *
 * `sector` (sector strength / weakness) and `gammaRoom` (room to the nearest
 * magnet or wall) are not properties of a `ScanRow` — they come from the
 * sectors page and the gamma map, wired in later ship-order steps. Until then
 * they are passed as `null`, render as "—", and drop out of the blend. The
 * arithmetic is identical whether they are present or not, so wiring them in
 * changes the numbers without touching this file's shape.
 *
 * Nothing here phrases a name as something to buy or sell. A high Leader Score
 * is the answer to "how strong is this, relative to the market, right now" and
 * nothing more — the setup label (see `setupLabel`) is a separate axis, exactly
 * so "top-ranked" cannot be read as "buy now".
 */

import { trendScore } from './score';
import type { ScanRow } from './types';

export type Direction = 'bullish' | 'bearish';

/** The seven components, shared by both directions; the meaning mirrors. */
export const DIRECTION_COMPONENT_KEYS = [
  'rs',
  'trend',
  'structure',
  'volume',
  'sector',
  'options',
  'gammaRoom',
] as const;
export type DirectionComponentKey = (typeof DIRECTION_COMPONENT_KEYS)[number];

export type ComponentWeights = Record<DirectionComponentKey, number>;

// --- the weights (tune here) -------------------------------------------------

/**
 * Bullish Leader Score weights, in points out of 100.
 *
 * 30 relative strength + 20 trend + 15 price structure + 10 volume demand +
 * 10 sector strength + 10 options quality + 5 gamma room. They sum to 100, but
 * nothing depends on that — `directionScore` renormalises over the components a
 * name actually has a reading for.
 */
export const BULLISH_LEADER_WEIGHTS: ComponentWeights = {
  rs: 30,
  trend: 20,
  structure: 15,
  volume: 10,
  sector: 10,
  options: 10,
  gammaRoom: 5,
};

/**
 * Bearish Laggard Score weights — the mirror image, same points:
 * 30 relative weakness + 20 downtrend + 15 breakdown structure + 10 selling
 * pressure + 10 sector weakness + 10 options quality + 5 gamma risk/room.
 */
export const BEARISH_LAGGARD_WEIGHTS: ComponentWeights = {
  rs: 30,
  trend: 20,
  structure: 15,
  volume: 10,
  sector: 10,
  options: 10,
  gammaRoom: 5,
};

export function weightsFor(direction: Direction): ComponentWeights {
  return direction === 'bullish' ? BULLISH_LEADER_WEIGHTS : BEARISH_LAGGARD_WEIGHTS;
}

/** Column headings, which differ by direction because the meaning mirrors. */
export const COMPONENT_LABEL: Record<Direction, Record<DirectionComponentKey, string>> = {
  bullish: {
    rs: 'Rel. strength',
    trend: 'Uptrend',
    structure: 'Structure',
    volume: 'Volume demand',
    sector: 'Sector strength',
    options: 'Options quality',
    gammaRoom: 'Gamma room',
  },
  bearish: {
    rs: 'Rel. weakness',
    trend: 'Downtrend',
    structure: 'Breakdown',
    volume: 'Selling pressure',
    sector: 'Sector weakness',
    options: 'Options quality',
    gammaRoom: 'Gamma room',
  },
};

// --- small helpers -----------------------------------------------------------

/** Linear map onto 0-100, clamped at both ends. Mirrors `score.ts`. */
function ramp(value: number, low: number, high: number): number {
  if (!(high > low)) return 0;
  return Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The bullish price-structure reading: near-term posture, 20-day MA + VWAP. */
function bullishStructure(row: ScanRow): number | null {
  const m = row.metrics;
  const parts: number[] = [];
  if (m.pctAbove20 !== null) parts.push(m.pctAbove20 >= 0 ? 100 : 0);
  if (m.pctAboveVwap !== null) parts.push(ramp(m.pctAboveVwap, -3, 8));
  return mean(parts);
}

/** The bearish breakdown reading: below the 20-day MA and below VWAP. */
function bearishStructure(row: ScanRow): number | null {
  const m = row.metrics;
  const parts: number[] = [];
  if (m.pctAbove20 !== null) parts.push(m.pctAbove20 < 0 ? 100 : 0);
  if (m.pctAboveVwap !== null) parts.push(ramp(-m.pctAboveVwap, -3, 8));
  return mean(parts);
}

/** The bearish mirror of `score.ts`'s trend sub-score: lower-lows posture. */
function bearishTrend(row: ScanRow): number | null {
  const m = row.metrics;
  const parts: number[] = [];
  if (m.pctAbove50 !== null) parts.push(m.pctAbove50 < 0 ? 100 : 0);
  if (m.pctAbove200 !== null) parts.push(m.pctAbove200 < 0 ? 100 : 0);
  if (m.ema50 !== null && m.ema200 !== null) parts.push(m.ema50 < m.ema200 ? 100 : 0);
  if (m.m1Percentile !== null) parts.push(Math.min(100, Math.max(0, 100 - m.m1Percentile)));
  return mean(parts);
}

/**
 * Options quality, 0-100. Whether the options trade at all (the weaker of
 * whole-chain volume and OI, log-scaled) nudged by the graded contract badge
 * when one exists. Direction-agnostic: a liquid chain has liquid calls and
 * liquid puts. Null when no chain was pulled.
 */
function optionsQualityScore(row: ScanRow): number | null {
  const volume = row.optionsVolume;
  const oi = row.optionsOpenInterest;
  if (volume === null || oi === null) return null;
  const byVolume = volume > 0 ? ramp(Math.log10(volume), 3, 6) : 0;
  const byOi = oi > 0 ? ramp(Math.log10(oi), 3, 6) : 0;
  let base = Math.min(byVolume, byOi);

  // A graded contract shifts the reading a little: an excellent chain earns a
  // small lift, an "avoid" a small haircut. Only when the grade exists.
  const badge = row.optionQuality?.badge;
  if (badge === 'excellent') base = Math.min(100, base + 10);
  else if (badge === 'tradable') base = Math.min(100, base + 5);
  else if (badge === 'caution') base = Math.max(0, base - 10);
  else if (badge === 'avoid') base = Math.max(0, base - 25);
  return base;
}

// --- inputs that are not on the row ------------------------------------------

/**
 * The two readings that come from other pages. Both optional and both null by
 * default, so a caller that has not wired them yet still gets a valid score
 * over the five components that are on the row.
 */
export interface DirectionInputs {
  /**
   * Sector strength 0-100 from the sectors/groups page, where 100 is the
   * strongest sector. Bullish reads it directly; bearish reads `100 - it`.
   */
  sectorStrength?: number | null;
  /**
   * Room to the relevant gamma level 0-100: for bullish, headroom to the
   * upside magnet / call wall; for bearish, room to the downside magnet / put
   * wall. 100 is plenty of room, 0 is pinned against it.
   */
  gammaRoom?: number | null;
}

// --- the score ---------------------------------------------------------------

export type DirectionComponents = Record<DirectionComponentKey, number | null>;

export interface DirectionScore {
  direction: Direction;
  /** 0-100, renormalised over the components that had a reading. */
  total: number;
  components: DirectionComponents;
  /** Components with no reading, so the blend can be reported honestly. */
  missing: DirectionComponentKey[];
  /** How many components contributed (7 minus `missing.length`). */
  measured: number;
}

function componentsFor(
  row: ScanRow,
  direction: Direction,
  inputs: DirectionInputs,
): DirectionComponents {
  const m = row.metrics;
  const rs = Number.isFinite(m.rsScore) ? Math.min(100, Math.max(0, m.rsScore)) : null;
  const sector = inputs.sectorStrength ?? null;
  const options = optionsQualityScore(row);
  const gammaRoom = inputs.gammaRoom ?? null;
  const volume = m.volumeRatio === null ? null : ramp(m.volumeRatio, 0.5, 2.5);

  if (direction === 'bullish') {
    return {
      rs,
      trend: trendScore(m).value,
      structure: bullishStructure(row),
      volume,
      sector,
      options,
      gammaRoom,
    };
  }
  return {
    // Relative weakness is the complement of relative strength.
    rs: rs === null ? null : 100 - rs,
    trend: bearishTrend(row),
    structure: bearishStructure(row),
    // Participation reads the same either way; on a laggard heavy volume is
    // selling pressure, which the other weak components already establish.
    volume,
    sector: sector === null ? null : 100 - sector,
    options,
    gammaRoom,
  };
}

/**
 * One name's direction score, renormalised over the components it has.
 *
 * `total` is 0 only when no component could be read at all — the same rule the
 * composite uses, and such a name sorts to the bottom where an unmeasurable one
 * belongs.
 */
export function directionScore(
  row: ScanRow,
  direction: Direction,
  inputs: DirectionInputs = {},
): DirectionScore {
  const components = componentsFor(row, direction, inputs);
  const weights = weightsFor(direction);

  let weighted = 0;
  let totalWeight = 0;
  const missing: DirectionComponentKey[] = [];

  for (const key of DIRECTION_COMPONENT_KEYS) {
    const value = components[key];
    if (value === null || !Number.isFinite(value)) {
      missing.push(key);
      continue;
    }
    weighted += value * weights[key];
    totalWeight += weights[key];
  }

  return {
    direction,
    total: totalWeight > 0 ? weighted / totalWeight : 0,
    components,
    missing,
    measured: DIRECTION_COMPONENT_KEYS.length - missing.length,
  };
}

/** Both scores for a row, for the places that show a name on both axes. */
export function bothDirectionScores(
  row: ScanRow,
  inputs: DirectionInputs = {},
): { bullish: DirectionScore; bearish: DirectionScore } {
  return {
    bullish: directionScore(row, 'bullish', inputs),
    bearish: directionScore(row, 'bearish', inputs),
  };
}
