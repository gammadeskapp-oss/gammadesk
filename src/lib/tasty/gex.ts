import type { FeedSnapshot, GexResult, GexStrike, SymbolState } from './types';

/**
 * Feed events → finished gamma numbers. Pure; no I/O, no imports at runtime.
 *
 * ## The formula, and only this formula
 *
 * Per contract: `gamma × OI × 100 × spot`, with gamma taken as-is from the
 * dxFeed Greeks event and OI from the Summary event. Nothing here prices an
 * option or solves a greek. Calls and puts are summed separately as positive
 * magnitudes, and net GEX is call GEX − put GEX — the simplified proxy that
 * assumes nothing about who holds which side beyond that one sign convention.
 *
 * The unit is dollars of underlying per $1 move, which is NOT the unit the
 * public pages use (theirs is per 1% move and carries a modelled greek), so a
 * number from here is never comparable to a number from there.
 *
 * ## Zero gamma
 *
 * The level where the cumulative net-GEX profile (summed upward from the lowest
 * strike) changes sign, linearly interpolated between the two strikes either
 * side, taking the crossing nearest spot when there are several. Per-strike net
 * GEX flips sign many times on noise; the cumulative curve flips where the book
 * as a whole does.
 */

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Mid of the underlying quote, falling back to the last trade. */
export function spotFrom(state: SymbolState | undefined): number | null {
  if (!state) return null;
  const q = state.quote;
  if (q && finite(q.bidPrice) && finite(q.askPrice) && q.bidPrice > 0 && q.askPrice >= q.bidPrice) {
    return (q.bidPrice + q.askPrice) / 2;
  }
  if (state.trade && finite(state.trade.price) && state.trade.price > 0) return state.trade.price;
  return null;
}

export function zeroGammaLevel(strikes: GexStrike[], spot: number): number | null {
  let cumulative = 0;
  let prev: { strike: number; cum: number } | null = null;
  let best: number | null = null;
  for (const row of strikes) {
    cumulative += row.netGex;
    if (prev && Math.sign(prev.cum) !== Math.sign(cumulative) && prev.cum !== 0) {
      const span = cumulative - prev.cum;
      const level = span === 0 ? row.strike : prev.strike + ((0 - prev.cum) / span) * (row.strike - prev.strike);
      if (best === null || Math.abs(level - spot) < Math.abs(best - spot)) best = level;
    }
    prev = { strike: row.strike, cum: cumulative };
  }
  return best;
}

export function computeGex(snapshot: FeedSnapshot, now: number = Date.now()): GexResult | null {
  const spot = spotFrom(snapshot.states.get(snapshot.underlying));
  if (spot === null) return null;

  const byStrike = new Map<number, GexStrike>();
  let used = 0;
  let atm: { distance: number; iv: number } | null = null;

  for (const ref of snapshot.options) {
    const state = snapshot.states.get(ref.streamerSymbol);
    const gamma = state?.greeks?.gamma;
    const oi = state?.summary?.openInterest;
    if (!finite(gamma) || !finite(oi) || oi < 0) continue;
    used += 1;

    const gex = gamma * oi * 100 * spot;
    const row = byStrike.get(ref.strike) ?? {
      strike: ref.strike,
      callGex: 0,
      putGex: 0,
      netGex: 0,
      callOi: 0,
      putOi: 0,
    };
    if (ref.type === 'call') {
      row.callGex += gex;
      row.callOi += oi;
    } else {
      row.putGex += gex;
      row.putOi += oi;
    }
    row.netGex = row.callGex - row.putGex;
    byStrike.set(ref.strike, row);

    // ATM IV, read straight off the event: the contract nearest 30 days and spot.
    const iv = state?.greeks?.volatility;
    if (finite(iv) && iv > 0) {
      const days = (Date.parse(`${ref.expiration}T20:00:00Z`) - now) / 86_400_000;
      const distance = Math.abs(days - 30) / 30 + Math.abs(ref.strike - spot) / spot * 10;
      if (!atm || distance < atm.distance) atm = { distance, iv };
    }
  }

  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  let callGex = 0;
  let putGex = 0;
  let totalCallOi = 0;
  let totalPutOi = 0;
  let max: GexStrike | null = null;
  for (const row of strikes) {
    callGex += row.callGex;
    putGex += row.putGex;
    totalCallOi += row.callOi;
    totalPutOi += row.putOi;
    if (!max || Math.abs(row.netGex) > Math.abs(max.netGex)) max = row;
  }

  return {
    spot,
    strikes,
    callGex,
    putGex,
    netGex: callGex - putGex,
    zeroGamma: zeroGammaLevel(strikes, spot),
    maxGexStrike: max ? max.strike : null,
    maxGex: max ? max.netGex : null,
    totalCallOi,
    totalPutOi,
    contractsUsed: used,
    contractsRequested: snapshot.options.length,
    atmIv: atm ? atm.iv : null,
  };
}

/** Largest |net GEX| strike strictly above / below spot. */
export function magnets(result: GexResult): {
  above: { strike: number; gex: number } | null;
  below: { strike: number; gex: number } | null;
} {
  let above: GexStrike | null = null;
  let below: GexStrike | null = null;
  for (const row of result.strikes) {
    if (row.strike > result.spot) {
      if (!above || Math.abs(row.netGex) > Math.abs(above.netGex)) above = row;
    } else if (row.strike < result.spot) {
      if (!below || Math.abs(row.netGex) > Math.abs(below.netGex)) below = row;
    }
  }
  return {
    above: above ? { strike: above.strike, gex: above.netGex } : null,
    below: below ? { strike: below.strike, gex: below.netGex } : null,
  };
}
