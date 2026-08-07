/**
 * Black-Scholes-Merton pricing and greeks, including the second-order greeks
 * (vanna, charm) that the VEX and CEX tabs are built from.
 *
 * Conventions used throughout:
 *   S     spot price of the underlying
 *   K     strike
 *   T     time to expiry in YEARS
 *   r     continuously-compounded risk-free rate (annualised, e.g. 0.043)
 *   q     continuous dividend yield (annualised, e.g. 0.012 for SPY)
 *   sigma implied volatility as a decimal (0.18 == 18%)
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Minimum time to expiry, in years, used to keep 0DTE greeks finite (~1 hour). */
export const MIN_T = 1 / (365 * 24);
/** Implied vol is clamped into this band so a bad quote can't produce nonsense. */
export const MIN_SIGMA = 0.005;
export const MAX_SIGMA = 5;

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard normal CDF — Hart's rational approximation, as given by West (2005),
 * "Better Approximations to Cumulative Normal Functions".
 *
 * The usual Abramowitz & Stegun 26.2.17 polynomial carries an absolute error of
 * ~7.5e-8. That is invisible at the money but completely swamps the price of a
 * deep out-of-the-money contract, and this table runs 30 strikes out on both
 * sides. Hart is accurate to roughly double precision across the whole range,
 * which keeps the wing greeks meaningful.
 */
export function normCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;

  const ax = Math.abs(x);
  let tail: number;

  if (ax > 37) {
    tail = 0;
  } else {
    const e = Math.exp(-0.5 * ax * ax);

    if (ax < 7.07106781186547) {
      let num = 3.52624965998911e-2 * ax + 0.700383064443688;
      num = num * ax + 6.37396220353165;
      num = num * ax + 33.912866078383;
      num = num * ax + 112.079291497871;
      num = num * ax + 221.213596169931;
      num = num * ax + 220.206867912376;

      let den = 8.83883476483184e-2 * ax + 1.75566716318264;
      den = den * ax + 16.064177579207;
      den = den * ax + 86.7807322029461;
      den = den * ax + 296.564248779674;
      den = den * ax + 637.333633378831;
      den = den * ax + 793.826512519948;
      den = den * ax + 440.413735824752;

      tail = (e * num) / den;
    } else {
      // Continued-fraction expansion for the far tail.
      let cf = ax + 0.65;
      cf = ax + 4 / cf;
      cf = ax + 3 / cf;
      cf = ax + 2 / cf;
      cf = ax + 1 / cf;
      tail = e / (cf * 2.506628274631);
    }
  }

  return x > 0 ? 1 - tail : tail;
}

export interface BsInputs {
  S: number;
  K: number;
  T: number;
  r: number;
  q: number;
  sigma: number;
}

export interface D1D2 {
  d1: number;
  d2: number;
  sqrtT: number;
  /** exp(-qT), the dividend discount factor. */
  dq: number;
  /** exp(-rT), the risk-free discount factor. */
  dr: number;
}

function sanitise(i: BsInputs): BsInputs {
  return {
    S: Math.max(i.S, 1e-8),
    K: Math.max(i.K, 1e-8),
    T: Math.max(i.T, MIN_T),
    r: i.r,
    q: i.q,
    sigma: Math.min(Math.max(i.sigma, MIN_SIGMA), MAX_SIGMA),
  };
}

export function dTerms(inputs: BsInputs): D1D2 {
  const { S, K, T, r, q, sigma } = sanitise(inputs);
  const sqrtT = Math.sqrt(T);
  const d1 =
    (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2, sqrtT, dq: Math.exp(-q * T), dr: Math.exp(-r * T) };
}

export function callPrice(inputs: BsInputs): number {
  const { S, K } = sanitise(inputs);
  const { d1, d2, dq, dr } = dTerms(inputs);
  return S * dq * normCdf(d1) - K * dr * normCdf(d2);
}

export function putPrice(inputs: BsInputs): number {
  const { S, K } = sanitise(inputs);
  const { d1, d2, dq, dr } = dTerms(inputs);
  return K * dr * normCdf(-d2) - S * dq * normCdf(-d1);
}

export function optionPrice(inputs: BsInputs, type: 'call' | 'put'): number {
  return type === 'call' ? callPrice(inputs) : putPrice(inputs);
}

export function delta(inputs: BsInputs, type: 'call' | 'put'): number {
  const { d1, dq } = dTerms(inputs);
  return type === 'call' ? dq * normCdf(d1) : dq * (normCdf(d1) - 1);
}

/**
 * Gamma — d(delta)/dS. Identical for calls and puts.
 * Units: change in delta (per share) per $1 move in spot.
 */
export function gamma(inputs: BsInputs): number {
  const { S, sigma } = sanitise(inputs);
  const { d1, sqrtT, dq } = dTerms(inputs);
  const g = (dq * normPdf(d1)) / (S * sigma * sqrtT);
  return Number.isFinite(g) ? g : 0;
}

/** Vega — dV/dsigma, per 1.00 (i.e. 100 vol points) change in vol. */
export function vega(inputs: BsInputs): number {
  const { S } = sanitise(inputs);
  const { d1, sqrtT, dq } = dTerms(inputs);
  const v = S * dq * normPdf(d1) * sqrtT;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Vanna — d(delta)/d(sigma) == d(vega)/dS. Identical for calls and puts.
 * Units: change in delta (per share) per 1.00 change in implied vol.
 */
export function vanna(inputs: BsInputs): number {
  const { sigma } = sanitise(inputs);
  const { d1, d2, dq } = dTerms(inputs);
  const v = (-dq * normPdf(d1) * d2) / sigma;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Charm — d(delta)/d(time passing), a.k.a. delta decay.
 * Units: change in delta (per share) per YEAR of time passing.
 * Reference: Haug, "The Complete Guide to Option Pricing Formulas".
 */
export function charm(inputs: BsInputs, type: 'call' | 'put'): number {
  const { T, r, q, sigma } = sanitise(inputs);
  const { d1, d2, sqrtT, dq } = dTerms(inputs);

  const shared =
    (dq * normPdf(d1) * (2 * (r - q) * T - d2 * sigma * sqrtT)) /
    (2 * T * sigma * sqrtT);

  const c =
    type === 'call'
      ? q * dq * normCdf(d1) - shared
      : -q * dq * normCdf(-d1) - shared;

  return Number.isFinite(c) ? c : 0;
}

/**
 * Recover implied volatility from an observed option price by bisection.
 * Bisection is slower than Newton but cannot diverge on the ragged, wide-spread
 * quotes that end-of-day free-tier data produces.
 *
 * Returns null when the price is outside the no-arbitrage bounds.
 */
export function impliedVol(
  price: number,
  base: Omit<BsInputs, 'sigma'>,
  type: 'call' | 'put',
): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;

  const { S, K, T, r, q } = sanitise({ ...base, sigma: 0.2 });
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);

  // No-arbitrage bounds. A price outside them has no implied vol.
  const intrinsic =
    type === 'call'
      ? Math.max(0, S * dq - K * dr)
      : Math.max(0, K * dr - S * dq);
  const upper = type === 'call' ? S * dq : K * dr;
  if (price <= intrinsic + 1e-9 || price >= upper - 1e-9) return null;

  let lo = MIN_SIGMA;
  let hi = MAX_SIGMA;

  for (let i = 0; i < 80; i += 1) {
    const mid = 0.5 * (lo + hi);
    const diff = optionPrice({ S, K, T, r, q, sigma: mid }, type) - price;
    if (Math.abs(diff) < 1e-8) return mid;
    if (diff > 0) hi = mid;
    else lo = mid;
  }

  const result = 0.5 * (lo + hi);
  return result > MIN_SIGMA * 1.01 && result < MAX_SIGMA * 0.99 ? result : null;
}
