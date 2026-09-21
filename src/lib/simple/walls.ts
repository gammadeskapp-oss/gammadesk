/**
 * Picking the wall a beginner is told about.
 *
 * "Possible resistance / hedging response area" has to name one level
 * everywhere. The homepage was using the biggest wall above spot and /decision
 * the nearest one, so the same book at the same moment named 780 on one page
 * and 771 on the other. Both were defensible; having both was not.
 *
 * The rule is *nearest strong*, in that order. The nearest strike alone can be
 * a trivial one that price walks through; the strongest alone can be five
 * percent away and irrelevant to the next hour. So: look at the strikes
 * closest to spot, and take the first one that is a serious size relative to
 * that neighbourhood.
 */

export interface StrikeGex {
  strike: number;
  gex: number;
}

/**
 * Strikes considered on each side before distance stops mattering.
 *
 * Exported so the level map can state the rule it is applying rather than
 * describing it from memory — a tooltip that quotes a number this file no
 * longer uses is worse than no tooltip.
 */
export const NEIGHBOURHOOD = 8;

/** Share of the neighbourhood's biggest wall that counts as "strong". */
export const STRONG_ENOUGH = 0.4;

/**
 * A dead-zone around spot, as a share of it, that no ceiling or floor may sit
 * inside.
 *
 * A ceiling a fifth of a strike above spot is not a level price is heading
 * *into* — it is the strike price already sits on, and calling it resistance
 * is noise. This shows up most on the volume view, where 0DTE flow piles onto
 * the at-the-money strike and the nearest wall each side lands a few cents off
 * spot. A tenth of a percent is below one SPY strike ($1 ≈ 0.13% near 760), so
 * in practice it excludes only the strike essentially on top of spot and never
 * a genuine level one strike out.
 *
 * Applied in this one shared rule, and in the two surfaces that draw their own
 * candidate lists (the walls view and the level map), so every place that names
 * a ceiling or floor excludes the same near-spot strikes and they cannot
 * disagree about it.
 */
export const MIN_LEVEL_DISTANCE_PCT = 0.001;

/** True when a strike is far enough from spot to be a ceiling or floor. */
export function clearsSpotDeadZone(strike: number, spot: number): boolean {
  return spot > 0 && Math.abs(strike - spot) / spot >= MIN_LEVEL_DISTANCE_PCT;
}

export function nearestStrongWall(
  rows: StrikeGex[],
  spot: number,
  side: 'above' | 'below',
): StrikeGex | null {
  const candidates = rows
    .filter((r) => Number.isFinite(r.gex) && Math.abs(r.gex) > 0)
    .filter((r) => (side === 'above' ? r.strike > spot : r.strike <= spot))
    .filter((r) => clearsSpotDeadZone(r.strike, spot))
    .sort((a, b) => (side === 'above' ? a.strike - b.strike : b.strike - a.strike))
    .slice(0, NEIGHBOURHOOD);

  if (candidates.length === 0) return null;

  const biggest = Math.max(...candidates.map((c) => Math.abs(c.gex)));
  const threshold = biggest * STRONG_ENOUGH;

  // Nearest first, so the first one clearing the bar is the answer.
  return candidates.find((c) => Math.abs(c.gex) >= threshold) ?? candidates[0];
}
