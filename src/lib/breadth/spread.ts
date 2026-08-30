import 'server-only';

import { spreadShape } from './compute';
import { fetchSparks } from './spark';
import type { EqualWeightSpread } from './types';

/**
 * Method B — the average company against the index, in two symbols.
 *
 * SPY holds the S&P 500 weighted by company size, so the largest handful of
 * companies drive most of its move. RSP — the Invesco S&P 500 Equal Weight ETF
 * — holds the same five hundred companies with every one counting the same.
 * Comparing the two days' changes therefore separates "the market moved" from
 * "a few giants moved".
 *
 * This runs on every refresh whether or not the full constituent sweep in
 * `universe.ts` succeeded. It costs one request, and it is the cross-check:
 * two independent methods disagreeing is something the page should print
 * rather than average away.
 */

/** The equal-weight S&P 500 ETF, and the size-weighted one. */
export const SPREAD_SYMBOLS = ['RSP', 'SPY'] as const;

function dayChangePct(closes: number[], previousClose: number): number {
  const last = closes[closes.length - 1];
  return ((last - previousClose) / previousClose) * 100;
}

/**
 * @returns null when either symbol could not be read. A spread computed from
 * one leg is not a spread.
 */
export async function fetchEqualWeightSpread(): Promise<EqualWeightSpread | null> {
  const { series } = await fetchSparks([...SPREAD_SYMBOLS], { timeoutMs: 10_000 });

  const rsp = series.get('RSP');
  const spy = series.get('SPY');
  if (!rsp || !spy) return null;

  const rspPct = dayChangePct(rsp.closes, rsp.previousClose);
  const spyPct = dayChangePct(spy.closes, spy.previousClose);
  const spreadPct = rspPct - spyPct;

  return {
    rspPct,
    spyPct,
    spreadPct,
    shape: spreadShape(spreadPct),
    at: new Date().toISOString(),
  };
}
