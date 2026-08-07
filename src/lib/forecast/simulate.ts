import { expiryForDay } from './magnets';
import type { ForecastBand, HorizonOdds, MagnetExpiry } from './types';

/**
 * Monte Carlo with magnet bending.
 *
 * Paths are ordinary log-normal steps, with one extra term: on each day the
 * step is nudged toward attractor strikes and away from repellers, using the
 * blended exposure field for whichever expiry is live at that point.
 *
 * The bend is expressed in units of the daily standard deviation and hard-
 * capped, so positioning shapes the distribution without ever overwhelming the
 * randomness. That cap is the whole reason this stays a simulation rather than
 * a deterministic slide toward the biggest strike.
 */

/** Hard ceiling on the bend, in daily sigmas. */
export const MAX_BEND_SIGMA = 0.3;

/** Trading days per year, for annualising. */
const TRADING_DAYS = 252;

/** Mulberry32 — small, fast, and seedable so a cached forecast is reproducible. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, returning one standard normal per call from a cached pair. */
function makeGaussian(random: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    // Guard against log(0).
    const u = Math.max(random(), Number.EPSILON);
    const v = random();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Net pull on a price from one expiry's magnet field, in daily sigmas.
 *
 * Each strike contributes `w * u * exp(-u^2/2)` where `u` is the distance in
 * kernel widths. That is the gradient of a Gaussian well: it pulls toward the
 * strike when the weight is positive, pushes away when negative, peaks about
 * one width out, and decays to nothing far away — so a distant strike cannot
 * reach across the board and drag a path.
 */
export function magnetBend(
  price: number,
  expiry: MagnetExpiry | null,
  kernelWidth: number,
): number {
  if (!expiry || kernelWidth <= 0) return 0;

  let force = 0;
  let capacity = 0;

  // Peak of u*exp(-u^2/2), used to normalise the sum into -1..1.
  const PEAK = Math.exp(-0.5);

  for (const { strike, weight } of expiry.strikes) {
    const u = (strike - price) / kernelWidth;
    if (u > 4 || u < -4) continue; // negligible, and keeps the loop short
    force += weight * u * Math.exp(-0.5 * u * u);
    capacity += Math.abs(weight) * PEAK;
  }

  if (capacity === 0) return 0;

  const normalised = force / capacity; // within -1..1 by construction
  return Math.max(-MAX_BEND_SIGMA, Math.min(MAX_BEND_SIGMA, normalised * MAX_BEND_SIGMA));
}

export interface SimulationInput {
  spot: number;
  /** Annualised volatility. */
  volatility: number;
  /** Annualised drift tilt from the signal blend. */
  annualDrift: number;
  horizon: number;
  paths: number;
  magnets: MagnetExpiry[];
  /** Fractional drawdown counted as a crash, e.g. 0.08. */
  crashThreshold: number;
  seed?: number;
}

export interface SimulationOutput {
  bands: ForecastBand[];
  odds: HorizonOdds[];
  crashPct: number;
  /** Share of days on which the bend was actually capped, for diagnostics. */
  bendSaturation: number;
}

const HORIZON_LABELS: Array<{ day: number; label: string }> = [
  { day: 3, label: '3D' },
  { day: 10, label: '10D' },
  { day: 20, label: '20D' },
];

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function simulate(input: SimulationInput): SimulationOutput {
  const { spot, volatility, annualDrift, horizon, paths, magnets, crashThreshold } = input;

  const random = makeRandom(input.seed ?? 0x5eed1234);
  const gaussian = makeGaussian(random);

  const dailySigma = volatility / Math.sqrt(TRADING_DAYS);
  const dailyDrift = annualDrift / TRADING_DAYS;
  // Kernel width: roughly one daily move, floored so a very calm tape does not
  // make every strike look infinitely far away.
  const kernelWidth = Math.max(spot * 0.0015, spot * dailySigma);

  // Which expiry governs each day, resolved once rather than per path.
  const expiryByDay: Array<MagnetExpiry | null> = [];
  for (let day = 1; day <= horizon; day += 1) {
    expiryByDay.push(expiryForDay(magnets, day));
  }

  // prices[day - 1] collects every path's price on that day.
  const prices: number[][] = Array.from({ length: horizon }, () => new Array(paths));

  let crashes = 0;
  let bendSamples = 0;
  let bendCapped = 0;

  for (let p = 0; p < paths; p += 1) {
    let price = spot;
    let crashed = false;
    const crashLevel = spot * (1 - crashThreshold);

    for (let day = 1; day <= horizon; day += 1) {
      const bend = magnetBend(price, expiryByDay[day - 1], kernelWidth);
      bendSamples += 1;
      if (Math.abs(bend) >= MAX_BEND_SIGMA - 1e-9) bendCapped += 1;

      const shock = gaussian() + bend;
      price *= Math.exp(dailyDrift - 0.5 * dailySigma * dailySigma + dailySigma * shock);

      // "Down more than 8% at any point" — measured on the daily closes the
      // simulation actually produces, not on an unobserved intraday low.
      if (!crashed && price <= crashLevel) crashed = true;

      prices[day - 1][p] = price;
    }

    if (crashed) crashes += 1;
  }

  const bands: ForecastBand[] = [];
  for (let day = 1; day <= horizon; day += 1) {
    const sorted = prices[day - 1].slice().sort((a, b) => a - b);
    bands.push({
      day,
      p2_5: percentile(sorted, 0.025),
      p16: percentile(sorted, 0.16),
      p50: percentile(sorted, 0.5),
      p84: percentile(sorted, 0.84),
      p97_5: percentile(sorted, 0.975),
    });
  }

  const odds: HorizonOdds[] = HORIZON_LABELS.filter((h) => h.day <= horizon).map(
    ({ day, label }) => {
      const column = prices[day - 1];
      let higher = 0;
      for (const value of column) if (value > spot) higher += 1;
      const sorted = column.slice().sort((a, b) => a - b);
      return {
        day,
        label,
        higherPct: (higher / column.length) * 100,
        medianPrice: percentile(sorted, 0.5),
      };
    },
  );

  return {
    bands,
    odds,
    crashPct: (crashes / paths) * 100,
    bendSaturation: bendSamples > 0 ? (bendCapped / bendSamples) * 100 : 0,
  };
}
