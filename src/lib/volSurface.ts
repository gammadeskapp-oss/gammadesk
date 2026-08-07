import { MIN_T } from './blackScholes';

/**
 * Fallback implied-volatility surface.
 *
 * Used only when a contract has no usable IV from the API and no usable price
 * to back one out of — which is common on Polygon's free end-of-day tier for
 * far out-of-the-money strikes. Shape is a plain equity-index skew: puts richer
 * than calls, wings wider than the money, and short-dated vol above long-dated.
 *
 * This is an approximation, not market data. Contracts priced off it are
 * counted separately and reported in the UI's data-quality footer.
 */
export function modelIv(spot: number, strike: number, T: number): number {
  const moneyness = Math.log(strike / Math.max(spot, 1e-8));
  const atm = 0.16 + 0.06 * Math.exp(-4 * Math.max(T, MIN_T));
  const skew = -0.9 * moneyness;
  const smile = 2.4 * moneyness * moneyness;
  return Math.min(1.5, Math.max(0.05, atm + skew + smile));
}
