/**
 * The composite, and the six component scores under it.
 *
 * Client-safe and dependency-free, because the weights are dragged in the
 * browser and the ranking has to re-derive on every keystroke without a
 * request. Nothing in this file reads a stored verdict; it reads the measured
 * values on a `LabRow` and blends them.
 *
 * ## Absent is not zero, and it is not a low score either
 *
 * The rule the rest of this app already applies, and the reason this page can
 * be trusted to answer the question it was built for. Most of the index has no
 * flow reading, most of it may have no chain, and none of it has an analogue
 * reading until it is asked for. Scoring those absences as zero would rank the
 * index by which jobs had time for which names — a statement about this site's
 * request budget wearing the clothes of a statement about the market.
 *
 * So an absent component is dropped and the remaining weights renormalise over
 * what is left. Every row prints which ones were dropped, and a row with fewer
 * measured components says so next to its total rather than quietly competing
 * as though it had all six.
 *
 * ## A weight of zero drops a component the same way
 *
 * Setting a weight to zero removes that component from the blend entirely
 * rather than multiplying it by nothing and leaving it in the denominator.
 * Those are the same arithmetic here, but they are not the same claim, and the
 * expansion says "weight 0, left out" rather than showing a component
 * contributing nothing and inviting the reader to wonder why.
 */

import { LAB_KEYS, type LabKey, type LabRow, type LabWeights } from './types';

/** Linear map onto 0-100, clamped at both ends. */
function ramp(value: number, low: number, high: number): number {
  if (!(high > low)) return 0;
  return Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
}

/**
 * Distance scored so that nearer is higher: 0% away is 100, `span`% away is 0.
 *
 * `span` is 8% for the flip and 5% for the magnets. Both are round numbers
 * picked to put the interesting range in the middle of the scale rather than
 * bunched at one end, and neither is a threshold — nothing passes or fails on
 * them, they only set how quickly the score falls away with distance.
 */
function nearness(pct: number, span: number): number {
  return ramp(span - Math.abs(pct), 0, span);
}

export const FLIP_SPAN_PCT = 8;
export const MAGNET_SPAN_PCT = 5;

/** The flow reading's top volume-to-open-interest, mapped onto the scale. */
export const FLOW_RATIO_SPAN = { low: 1, high: 5 } as const;

export type LabComponents = Record<LabKey, number | null>;

export interface LabScore {
  /** 0-100. */
  total: number;
  components: LabComponents;
  /** Components with no reading at all. Dropped from the blend. */
  missing: LabKey[];
  /** Components the reader has weighted to zero. Also dropped, but said so. */
  zeroed: LabKey[];
  /** How many components actually contributed to `total`. */
  measured: number;
  /** True when nothing contributed, so `total` is 0 for want of inputs. */
  empty: boolean;
}

/**
 * Every component's raw score for one name, before any weighting.
 *
 * Split out from `scoreRow` so the table can sort a column by its component
 * score without re-blending, and so the expansion can show the score beside
 * the raw value it came from.
 */
export function labComponents(row: LabRow): LabComponents {
  const magnetPct = nearestMagnetPct(row);

  return {
    /*
     * Two values, 100 and 25 rather than 100 and 0 — copied deliberately from
     * `scanner/score.ts` so a name cannot read one way here and another way
     * there. Negative dealer gamma is a real caution; it is also an inference
     * about who is on the other side of a single stock's chain, which nobody
     * publishes.
     */
    gammaRegime: row.regime === null ? null : row.regime === 'positive' ? 100 : 25,

    flipDistance:
      row.flipPct === null ? null : nearness(row.flipPct, FLIP_SPAN_PCT),

    magnetDistance: magnetPct === null ? null : nearness(magnetPct, MAGNET_SPAN_PCT),

    /*
     * Used exactly as /strength publishes it. Rescaling a number the reader
     * can go and look up would make the two pages disagree about the same
     * name, and this page is worth nothing if its inputs cannot be checked.
     */
    rs:
      row.rsScore === null || !Number.isFinite(row.rsScore)
        ? null
        : Math.min(100, Math.max(0, row.rsScore)),

    flow: flowScore(row),

    analogue: row.analogue?.positivePct ?? null,
  };
}

/**
 * The closer of the two magnet distances, as an unsigned percent.
 *
 * The closer one rather than an average of the pair: a name pinned just under
 * a large strike and a name sitting midway between two are different
 * situations, and averaging their distances makes them the same number.
 */
export function nearestMagnetPct(row: LabRow): number | null {
  const above = row.magnetAbovePct === null ? null : Math.abs(row.magnetAbovePct);
  const below = row.magnetBelowPct === null ? null : Math.abs(row.magnetBelowPct);
  if (above === null && below === null) return null;
  if (above === null) return below;
  if (below === null) return above;
  return Math.min(above, below);
}

/**
 * How unusual the busiest contract on this name was.
 *
 * A name the flow scan covered and flagged nothing on scores 0, and that is a
 * real reading: the chain was looked at and nothing stood out. A name the scan
 * never reached returns null and is dropped from the blend. Collapsing those
 * two is the mistake this whole file is arranged to prevent.
 */
function flowScore(row: LabRow): number | null {
  if (!row.flow) return null;
  const top = row.flow.topVolumeToOi;
  if (top === null) return 0;
  return ramp(top, FLOW_RATIO_SPAN.low, FLOW_RATIO_SPAN.high);
}

/** One name's composite at the reader's current weights. */
export function scoreLabRow(row: LabRow, weights: LabWeights): LabScore {
  const components = labComponents(row);

  let weighted = 0;
  let totalWeight = 0;
  const missing: LabKey[] = [];
  const zeroed: LabKey[] = [];
  let measured = 0;

  for (const key of LAB_KEYS) {
    const value = components[key];
    if (value === null) {
      missing.push(key);
      continue;
    }
    if (!(weights[key] > 0)) {
      zeroed.push(key);
      continue;
    }
    weighted += value * weights[key];
    totalWeight += weights[key];
    measured += 1;
  }

  return {
    total: totalWeight > 0 ? weighted / totalWeight : 0,
    components,
    missing,
    zeroed,
    measured,
    empty: totalWeight === 0,
  };
}
