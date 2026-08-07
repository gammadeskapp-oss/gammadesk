import { daysToExpiry } from '../time';
import type { PositioningData } from '../types';
import type { MagnetExpiry, MagnetStrike } from './types';

/**
 * Blend weights across the three exposure surfaces.
 *
 * Gamma dominates because it is the exposure that forces the most immediate
 * hedging; vanna and charm shape the drift more slowly.
 */
export const BLEND = { gamma: 0.6, vanna: 0.3, charm: 0.1 } as const;

/** Strikes contributing less than this share of the peak are dropped. */
const SIGNIFICANCE = 0.04;

/**
 * Turn the positioning table into a magnet field, one set of strikes per
 * expiration.
 *
 * Each metric is normalised against the largest absolute value within its own
 * expiration before blending, because gamma, vanna and charm exposures are
 * quoted in different units and differ by orders of magnitude. Without that,
 * the 0.6/0.3/0.1 blend would be meaningless — whichever metric happened to be
 * largest in raw dollars would swamp the other two.
 *
 * Sign convention follows the dashboard: positive exposure attracts (dealers
 * hedge against the move, pinning price), negative repels (hedging amplifies
 * the move, pushing price away).
 */
export function buildMagnetField(data: PositioningData): MagnetExpiry[] {
  const out: MagnetExpiry[] = [];

  data.expirationMeta.forEach((expiry, column) => {
    let maxGex = 0;
    let maxVex = 0;
    let maxCex = 0;

    for (const row of data.rows) {
      const cell = row.cells[column];
      if (!cell) continue;
      maxGex = Math.max(maxGex, Math.abs(cell.gex));
      maxVex = Math.max(maxVex, Math.abs(cell.vex));
      maxCex = Math.max(maxCex, Math.abs(cell.cex));
    }

    if (maxGex === 0 && maxVex === 0 && maxCex === 0) return;

    const raw: MagnetStrike[] = [];
    let peak = 0;

    for (const row of data.rows) {
      const cell = row.cells[column];
      if (!cell) continue;

      const weight =
        BLEND.gamma * (maxGex > 0 ? cell.gex / maxGex : 0) +
        BLEND.vanna * (maxVex > 0 ? cell.vex / maxVex : 0) +
        BLEND.charm * (maxCex > 0 ? cell.cex / maxCex : 0);

      if (!Number.isFinite(weight) || weight === 0) continue;
      peak = Math.max(peak, Math.abs(weight));
      raw.push({ strike: row.strike, weight, gex: cell.gex });
    }

    if (peak === 0) return;

    // Rescale so the strongest strike in each expiry is +/-1. The bend is then
    // expressed relative to the dominant magnet rather than to absolute dollars,
    // which keeps early and late expiries on a comparable footing even though
    // front-month open interest is far larger.
    const strikes = raw
      .map((s) => ({ ...s, weight: s.weight / peak }))
      .filter((s) => Math.abs(s.weight) >= SIGNIFICANCE)
      .sort((a, b) => a.strike - b.strike);

    if (strikes.length === 0) return;

    out.push({
      date: expiry.date,
      label: expiry.label,
      // Calendar days to trading days. Approximate, but the expiries in play
      // are days apart, not months, so the error is under a session.
      tradingDay: Math.max(0, Math.round(daysToExpiry(expiry.date) * (5 / 7))),
      strikes,
    });
  });

  return out.sort((a, b) => a.tradingDay - b.tradingDay);
}

/**
 * Which expiry governs a given day forward: the nearest one that has not
 * expired yet. Returns null once the chain runs out, after which paths evolve
 * on volatility alone.
 */
export function expiryForDay(field: MagnetExpiry[], day: number): MagnetExpiry | null {
  for (const expiry of field) {
    if (expiry.tradingDay >= day) return expiry;
  }
  return null;
}
