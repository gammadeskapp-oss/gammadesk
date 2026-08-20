/**
 * Nadaraya-Watson kernel regression, in the **non-repainting** form.
 *
 * ## Why this form and not the usual one
 *
 * The widely-copied TradingView envelope fits the kernel across the *whole*
 * visible series, so every historical value is recomputed as new bars arrive
 * and the line visibly redraws behind price. That version is fine to look at
 * and useless to scan with: the value it shows for 09:35 today is not the
 * value it will show for 09:35 tomorrow, so a scanner built on it would
 * disagree with the reader's own chart by the time they opened it.
 *
 * This is the endpoint estimator instead. At each bar the fit uses that bar
 * and the bars before it, never the bars after, so a value once printed never
 * changes. It is the same construction as LuxAlgo's non-repainting variant,
 * and its inputs are the same three numbers, which is the point — the reader
 * can set `GAMMADESK_SCAN_NW_*` to whatever their chart is using and the two
 * will agree.
 *
 * ## The maths
 *
 *   nw[t] = Σ w(i)·close[t−i] / Σ w(i),   w(i) = exp(−i² / (2h²))
 *
 * with i running back over `lookback` bars. The envelope sits at the mean
 * absolute error between price and the fit, over the same window, times
 * `mult`:
 *
 *   mae   = mean(|close[j] − nw[j]|)
 *   upper = nw + mae·mult
 *   lower = nw − mae·mult
 *
 * No `server-only` here on purpose. The scan computes the band on the server
 * and the chart draws it in the browser; running one implementation in both
 * places is what stops the row and the picture beside it disagreeing.
 */

import type { NwState } from './types';

export interface NwSettings {
  /** Gaussian bandwidth, h. Larger is smoother. */
  bandwidth: number;
  /** Bars the fit and the band width are measured over. */
  lookback: number;
  /** Multiple of mean absolute error the envelope sits at. */
  mult: number;
}

export interface NwPoint {
  mid: number;
  upper: number;
  lower: number;
}

export interface NwSeries {
  /** One entry per input close; `null` before the fit is defined. */
  points: (NwPoint | null)[];
  /** Bars the newest fit actually had, which may be under `lookback`. */
  barsUsed: number;
  barsWanted: number;
}

/**
 * Gaussian weights for offsets 0..n−1, computed once per call.
 *
 * The tail is not truncated. `exp(−i²/2h²)` is already denormal-small well
 * before i reaches the default lookback, so truncating would save time we do
 * not need and introduce a discrepancy against the reader's chart, which does
 * not truncate either.
 */
function weights(n: number, bandwidth: number): number[] {
  const denom = 2 * bandwidth * bandwidth;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.exp(-(i * i) / denom);
  return out;
}

/**
 * The endpoint fit at every bar.
 *
 * At bar `t` the window is the `min(lookback, t+1)` bars ending at `t`. Early
 * bars therefore fit over less history — exactly what a chart does at its left
 * edge — rather than being left undefined, which would throw away the first
 * few hundred bars of a series that only has a few hundred.
 */
function midline(closes: number[], settings: NwSettings): number[] {
  const w = weights(Math.min(settings.lookback, closes.length), settings.bandwidth);
  const out = new Array<number>(closes.length);

  for (let t = 0; t < closes.length; t += 1) {
    const span = Math.min(w.length, t + 1);
    let num = 0;
    let den = 0;
    for (let i = 0; i < span; i += 1) {
      num += closes[t - i] * w[i];
      den += w[i];
    }
    out[t] = den > 0 ? num / den : closes[t];
  }

  return out;
}

/**
 * The full envelope series.
 *
 * `mae` is a trailing mean over the same `lookback`, so it too is
 * non-repainting: the band width at bar `t` depends only on bars up to `t`.
 */
export function nadarayaWatson(closes: number[], settings: NwSettings): NwSeries {
  const barsWanted = settings.lookback;
  const barsUsed = Math.min(barsWanted, closes.length);

  if (closes.length === 0) {
    return { points: [], barsUsed: 0, barsWanted };
  }

  const mid = midline(closes, settings);

  // Running sum of the absolute error, so the trailing mean is O(n) overall
  // rather than O(n·lookback).
  const points: (NwPoint | null)[] = new Array(closes.length).fill(null);
  let sum = 0;

  for (let t = 0; t < closes.length; t += 1) {
    sum += Math.abs(closes[t] - mid[t]);
    if (t >= barsWanted) sum -= Math.abs(closes[t - barsWanted] - mid[t - barsWanted]);

    const span = Math.min(barsWanted, t + 1);
    const mae = (sum / span) * settings.mult;

    points[t] = { mid: mid[t], upper: mid[t] + mae, lower: mid[t] - mae };
  }

  return { points, barsUsed, barsWanted };
}

/**
 * Where the last close sits relative to the last band.
 *
 * Returns `unknown` rather than guessing when there is not enough history.
 * The caller excludes the ticker and says why; it must never be folded into
 * `below`, which is a claim about the market rather than about the data.
 */
export function nwState(
  closes: number[],
  settings: NwSettings,
  minBars: number,
): { state: NwState; point: NwPoint | null; barsUsed: number; barsWanted: number } {
  if (closes.length < minBars) {
    return {
      state: 'unknown',
      point: null,
      barsUsed: closes.length,
      barsWanted: settings.lookback,
    };
  }

  const series = nadarayaWatson(closes, settings);
  const point = series.points[series.points.length - 1];
  const close = closes[closes.length - 1];

  if (!point || !Number.isFinite(point.mid)) {
    return {
      state: 'unknown',
      point: null,
      barsUsed: series.barsUsed,
      barsWanted: series.barsWanted,
    };
  }

  const state: NwState =
    close > point.upper ? 'above' : close < point.lower ? 'below' : 'inside';

  return { state, point, barsUsed: series.barsUsed, barsWanted: series.barsWanted };
}
