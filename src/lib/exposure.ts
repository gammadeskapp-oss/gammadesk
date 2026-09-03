import {
  charm,
  gamma as bsGamma,
  vanna as bsVanna,
} from './blackScholes';
import { daysToExpiry, formatExpiryLabel } from './time';
import type {
  DataMeta,
  IvSource,
  Metrics,
  NormalisedContract,
  PositioningData,
  StrikeRow,
  Summary,
} from './types';

/** Shares of the underlying controlled by one option contract. */
const CONTRACT_MULTIPLIER = 100;

/**
 * Dealer positioning convention (the standard SqueezeMetrics assumption, and
 * the one the brief specifies): customers buy puts for protection and sell
 * calls for yield, so the dealer on the other side is LONG calls and SHORT
 * puts. A call therefore contributes positive exposure and a put negative.
 */
function dealerSign(type: 'call' | 'put'): 1 | -1 {
  return type === 'call' ? 1 : -1;
}

export function emptyMetrics(): Metrics {
  return { gex: 0, vex: 0, cex: 0, oi: 0, callGex: 0, putGex: 0, callOi: 0, putOi: 0 };
}

function accumulate(target: Metrics, source: Metrics): void {
  target.gex += source.gex;
  target.vex += source.vex;
  target.cex += source.cex;
  target.oi += source.oi;
  target.callGex += source.callGex;
  target.putGex += source.putGex;
  target.callOi += source.callOi;
  target.putOi += source.putOi;
}

export interface GreekParams {
  spot: number;
  riskFreeRate: number;
  dividendYield: number;
}

/**
 * Exposure contributed by a single contract, expressed in dollars so the four
 * tabs are directly comparable:
 *
 *   GEX  dollars of dealer delta gained per +1% move in spot
 *   VEX  dollars of dealer delta gained per +1 volatility point
 *   CEX  dollars of dealer delta gained per calendar day of decay
 *   OI   contracts, signed calls-minus-puts
 */
export function contractMetrics(
  contract: NormalisedContract,
  params: GreekParams,
): Metrics {
  const { spot: S, riskFreeRate: r, dividendYield: q } = params;
  const { strike: K, T, iv: sigma, openInterest, type } = contract;

  const sign = dealerSign(type);
  const notional = sign * openInterest * CONTRACT_MULTIPLIER;
  const inputs = { S, K, T, r, q, sigma };

  // gamma is per $1 of spot; multiply by S once for dollar delta and again by
  // 1% of S to express the result per 1% move.
  const gex = notional * bsGamma(inputs) * S * S * 0.01;

  // vanna is per 1.00 of vol; divide by 100 to quote it per vol point.
  const vex = (notional * bsVanna(inputs) * S) / 100;

  // charm is per year; divide by 365 to quote it per calendar day.
  const cex = (notional * charm(inputs, type) * S) / 365;

  return {
    gex,
    vex,
    cex,
    oi: sign * openInterest,
    // Same dollars as `gex`, kept on the side the contract came from. One of
    // the two is always zero, so summing them back gives `gex` exactly.
    callGex: type === 'call' ? gex : 0,
    putGex: type === 'put' ? gex : 0,
    callOi: type === 'call' ? openInterest : 0,
    putOi: type === 'put' ? openInterest : 0,
  };
}

/** Net dealer gamma exposure across every contract at a hypothetical spot. */
function netGexAtSpot(
  contracts: NormalisedContract[],
  hypotheticalSpot: number,
  params: GreekParams,
): number {
  let total = 0;
  for (const c of contracts) {
    const inputs = {
      S: hypotheticalSpot,
      K: c.strike,
      T: c.T,
      r: params.riskFreeRate,
      q: params.dividendYield,
      sigma: c.iv,
    };
    total +=
      dealerSign(c.type) *
      c.openInterest *
      CONTRACT_MULTIPLIER *
      bsGamma(inputs) *
      hypotheticalSpot *
      hypotheticalSpot *
      0.01;
  }
  return total;
}

/**
 * The gamma flip (a.k.a. zero-gamma) level: the spot price at which aggregate
 * dealer gamma changes sign.
 *
 * Rather than the common shortcut of interpolating the strike ladder, this
 * re-prices the whole book across a grid of hypothetical spot prices — holding
 * implied vol and time to expiry fixed — and linearly interpolates the sign
 * change nearest to the current spot. Returns null when the book never crosses
 * zero inside +/-15% of spot.
 */
export function findGammaFlip(
  contracts: NormalisedContract[],
  params: GreekParams,
): number | null {
  const S = params.spot;
  const lo = S * 0.85;
  const hi = S * 1.15;
  const steps = 180;
  const width = (hi - lo) / steps;

  let prevSpot = lo;
  let prevValue = netGexAtSpot(contracts, lo, params);

  let best: number | null = null;
  let bestDistance = Infinity;

  for (let i = 1; i <= steps; i += 1) {
    const spot = lo + i * width;
    const value = netGexAtSpot(contracts, spot, params);

    if (prevValue === 0) {
      const distance = Math.abs(prevSpot - S);
      if (distance < bestDistance) {
        best = prevSpot;
        bestDistance = distance;
      }
    } else if ((prevValue < 0 && value > 0) || (prevValue > 0 && value < 0)) {
      const crossing =
        prevSpot + (width * -prevValue) / (value - prevValue);
      const distance = Math.abs(crossing - S);
      if (distance < bestDistance) {
        best = crossing;
        bestDistance = distance;
      }
    }

    prevSpot = spot;
    prevValue = value;
  }

  return best;
}

export interface BuildOptions extends GreekParams {
  symbol: string;
  expirationCount: number;
  strikesEachSide: number;
  meta: Omit<DataMeta, 'contractsUsed' | 'ivSources'>;
}

/**
 * Assemble the full dashboard payload: pick the expirations and strikes to
 * display, aggregate every contract into its cell, and derive the summary.
 */
export function buildPositioning(
  allContracts: NormalisedContract[],
  options: BuildOptions,
): PositioningData {
  const { spot, expirationCount, strikesEachSide } = options;
  const params: GreekParams = {
    spot,
    riskFreeRate: options.riskFreeRate,
    dividendYield: options.dividendYield,
  };

  // --- choose the expiration columns -------------------------------------
  const expirations = Array.from(new Set(allContracts.map((c) => c.expiration)))
    .sort()
    .slice(0, expirationCount);
  const expirationIndex = new Map(expirations.map((e, i) => [e, i]));

  const inScope = allContracts.filter((c) => expirationIndex.has(c.expiration));

  // --- choose the strike rows --------------------------------------------
  const allStrikes = Array.from(new Set(inScope.map((c) => c.strike))).sort(
    (a, b) => a - b,
  );
  const below = allStrikes.filter((s) => s <= spot).slice(-strikesEachSide);
  const above = allStrikes.filter((s) => s > spot).slice(0, strikesEachSide);
  const strikes = [...below, ...above];
  const strikeSet = new Set(strikes);

  // --- aggregate ----------------------------------------------------------
  const rowMap = new Map<number, StrikeRow>();
  for (const strike of strikes) {
    rowMap.set(strike, {
      strike,
      cells: expirations.map(() => emptyMetrics()),
      total: emptyMetrics(),
    });
  }

  const columnTotals = expirations.map(() => emptyMetrics());
  const grandTotal = emptyMetrics();
  const ivSources: Record<IvSource, number> = { quoted: 0, solved: 0, model: 0 };

  let contractsUsed = 0;

  for (const contract of inScope) {
    if (!strikeSet.has(contract.strike)) continue;
    const col = expirationIndex.get(contract.expiration);
    if (col === undefined) continue;

    const metrics = contractMetrics(contract, params);
    const row = rowMap.get(contract.strike);
    if (!row) continue;

    accumulate(row.cells[col], metrics);
    accumulate(row.total, metrics);
    accumulate(columnTotals[col], metrics);
    accumulate(grandTotal, metrics);

    ivSources[contract.ivSource] += 1;
    contractsUsed += 1;
  }

  // Highest strike first — the conventional orientation for an options ladder.
  const rows = strikes
    .slice()
    .sort((a, b) => b - a)
    .map((s) => rowMap.get(s)!)
    .filter(Boolean);

  // --- summary ------------------------------------------------------------
  const flipLevel = findGammaFlip(inScope, params);

  /*
   * The nearest expiration's flip, priced from that expiration alone.
   *
   * Worth its own number because short-dated gamma dominates the next few
   * sessions and decays out of the book fastest, so the front week's crossing
   * routinely sits on the other side of spot from the full chain's. Blending
   * them would hide exactly the disagreement that matters.
   *
   * This re-prices a strictly smaller contract set over the same grid, so it
   * costs a fraction of the full-chain pass that just ran. Only meaningful
   * when there is more than one expiration in scope — with one, it would
   * simply restate `flipLevel`.
   */
  const frontExpiration = expirations.length > 1 ? expirations[0] : null;
  const frontFlipLevel =
    frontExpiration === null
      ? null
      : findGammaFlip(
          inScope.filter((c) => c.expiration === frontExpiration),
          params,
        );

  let magnetAbove: Summary['magnetAbove'] = null;
  let magnetBelow: Summary['magnetBelow'] = null;

  for (const row of rows) {
    const magnitude = Math.abs(row.total.gex);
    if (magnitude === 0) continue;

    if (row.strike > spot) {
      if (!magnetAbove || magnitude > Math.abs(magnetAbove.gex)) {
        magnetAbove = { strike: row.strike, gex: row.total.gex };
      }
    } else if (!magnetBelow || magnitude > Math.abs(magnetBelow.gex)) {
      magnetBelow = { strike: row.strike, gex: row.total.gex };
    }
  }

  const summary: Summary = {
    spot,
    netGex: grandTotal.gex,
    regime: grandTotal.gex >= 0 ? 'positive' : 'negative',
    flipLevel,
    frontFlipLevel,
    frontExpiration,
    magnetAbove,
    magnetBelow,
    totalCallOi: grandTotal.callOi,
    totalPutOi: grandTotal.putOi,
    putCallOiRatio:
      grandTotal.callOi > 0 ? grandTotal.putOi / grandTotal.callOi : null,
  };

  return {
    symbol: options.symbol,
    spot,
    expirations,
    expirationMeta: expirations.map((date) => ({
      date,
      label: formatExpiryLabel(date),
      dte: daysToExpiry(date),
    })),
    rows,
    columnTotals,
    grandTotal,
    summary,
    meta: { ...options.meta, contractsUsed, ivSources },
  };
}
