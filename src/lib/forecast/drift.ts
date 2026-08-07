import { latest, sma } from '../ticker/indicators';
import type { Bar } from '../ticker/types';
import type { DriftBlend } from './types';

/**
 * Baseline drift from a small blend of backward-looking signals.
 *
 * The tilt is deliberately tiny. Daily volatility for SPY is around 1%, so even
 * the maximum tilt here moves the median path by a fraction of one day's noise
 * over the whole horizon. Anything larger would be asserting a forecasting
 * edge that a moving-average crossover does not have.
 */

/** Largest annualised drift the blend can produce, in either direction. */
export const MAX_ANNUAL_TILT = 0.08;

export function buildDrift(bars: Bar[]): DriftBlend {
  const closes = bars.map((b) => b.close);
  const price = closes[closes.length - 1];

  const components: DriftBlend['components'] = [];

  // --- 1. Price against its 50- and 200-day averages ------------------------
  const ma50 = latest(sma(closes, 50));
  const ma200 = latest(sma(closes, 200));

  let trendScore = 0;
  const above50 = ma50 !== null && price > ma50;
  const above200 = ma200 !== null && price > ma200;
  if (ma50 !== null) trendScore += above50 ? 0.5 : -0.5;
  if (ma200 !== null) trendScore += above200 ? 0.5 : -0.5;

  components.push({
    name: 'Trend vs 50/200 DMA',
    score: trendScore,
    detail:
      ma50 === null || ma200 === null
        ? 'insufficient history for both averages'
        : `price ${price.toFixed(2)} · 50d ${ma50.toFixed(2)} · 200d ${ma200.toFixed(2)}`,
  });

  // --- 2. Twenty-session momentum ------------------------------------------
  const lookback = Math.min(20, closes.length - 1);
  const then = closes[closes.length - 1 - lookback];
  const roc = then > 0 ? price / then - 1 : 0;
  // Saturate at +/-5%, so one violent month does not dominate the blend.
  const momentumScore = Math.max(-1, Math.min(1, roc / 0.05));

  components.push({
    name: '20-day momentum',
    score: momentumScore,
    detail: `${roc >= 0 ? '+' : ''}${(roc * 100).toFixed(1)}% over ${lookback} sessions`,
  });

  const score =
    components.reduce((acc, c) => acc + c.score, 0) / Math.max(1, components.length);
  const clamped = Math.max(-1, Math.min(1, score));

  return {
    score: clamped,
    annualDrift: clamped * MAX_ANNUAL_TILT,
    components,
    unavailable: [
      'Market breadth (advance/decline, % above 200 DMA) — no free source available, so it is left out rather than approximated.',
    ],
  };
}
