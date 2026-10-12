/*
 * Rolling the flagged contracts up per ticker, and the day's call/put totals.
 *
 * Pure, like `score.ts` — the grouped table and the summary bar are rendered on
 * the client over the already-filtered rows, so this cannot touch the server.
 * Premium is the organising quantity throughout: biggest dollars first, at the
 * ticker level and within each ticker.
 */

import type { FlowRow } from './types';

/** A null premium contributes nothing to a dollar total rather than NaN. */
function prem(row: FlowRow): number {
  return row.premium ?? 0;
}

export interface FlowTotals {
  callPremium: number;
  putPremium: number;
  total: number;
}

/** Call dollars, put dollars, and their sum across a set of rows. */
export function flowTotals(rows: FlowRow[]): FlowTotals {
  let callPremium = 0;
  let putPremium = 0;
  for (const row of rows) {
    if (row.type === 'call') callPremium += prem(row);
    else putPremium += prem(row);
  }
  return { callPremium, putPremium, total: callPremium + putPremium };
}

export interface TickerGroup {
  symbol: string;
  spot: number;
  callPremium: number;
  putPremium: number;
  /** callPremium + putPremium, the sort key. */
  totalPremium: number;
  /** Distinct strikes flagged for this name. */
  strikeCount: number;
  callContracts: number;
  putContracts: number;
  /** Every flagged contract for this ticker, biggest dollars first. */
  rows: FlowRow[];
}

/**
 * Group rows by ticker, each group biggest-dollars-first and the groups
 * themselves ordered the same way.
 *
 * Within a ticker, contracts are sorted by premium descending with a null
 * premium always last — an unknown dollar figure cannot claim a place above a
 * known one. Ties fall back to the raw volume so the ordering is stable.
 */
export function groupByTicker(rows: FlowRow[]): TickerGroup[] {
  const bySymbol = new Map<string, FlowRow[]>();
  for (const row of rows) {
    const bucket = bySymbol.get(row.symbol);
    if (bucket) bucket.push(row);
    else bySymbol.set(row.symbol, [row]);
  }

  const groups: TickerGroup[] = [];
  for (const [symbol, bucket] of bySymbol) {
    const totals = flowTotals(bucket);
    const sorted = bucket.slice().sort((a, b) => {
      const pa = a.premium ?? -1;
      const pb = b.premium ?? -1;
      return pb - pa || b.volume - a.volume;
    });
    groups.push({
      symbol,
      spot: bucket[0].spot,
      callPremium: totals.callPremium,
      putPremium: totals.putPremium,
      totalPremium: totals.total,
      strikeCount: new Set(bucket.map((r) => r.strike)).size,
      callContracts: bucket.filter((r) => r.type === 'call').length,
      putContracts: bucket.filter((r) => r.type === 'put').length,
      rows: sorted,
    });
  }

  return groups.sort(
    (a, b) => b.totalPremium - a.totalPremium || b.rows.length - a.rows.length,
  );
}

export interface TopTicker {
  symbol: string;
  callPremium: number;
  putPremium: number;
  total: number;
}

/** The `n` tickers with the most option money, for the summary bar. */
export function topTickers(groups: TickerGroup[], n: number): TopTicker[] {
  return groups.slice(0, n).map((g) => ({
    symbol: g.symbol,
    callPremium: g.callPremium,
    putPremium: g.putPremium,
    total: g.totalPremium,
  }));
}
