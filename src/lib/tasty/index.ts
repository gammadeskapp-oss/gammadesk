import 'server-only';

import type { Metrics, PositioningData, StrikeRow, Summary } from '../types';
import { getSpotQuote } from '../spot';
import { daysToExpiry, formatAsOf, formatExpiryLabel } from '../time';
import { computeGex, magnets } from './gex';
import { mockSnapshot } from './mock';
import type { FeedSnapshot, GexResult, TastySourceMode } from './types';

/**
 * The one entry point `/lab` reads the Tastytrade source through.
 *
 * `TASTY_SOURCE=live` reads dxLink; anything else — unset included — reads the
 * mock. Default-mock means a deploy with no Tastytrade credentials renders a
 * clearly-labelled synthetic page instead of an error, and going live is a
 * deliberate env change rather than a side effect of a key being present.
 *
 * Everything returned here is a finished number. No token, URL, raw event or
 * env value is on this object, and it is what the pages hand to components.
 *
 * Read fresh on every call: no cache sits in front of the price or the gamma.
 * The mock is regenerated from the clock; the live path reads the latest events
 * the socket holds.
 */

export function tastySourceMode(): TastySourceMode {
  const key = 'TASTY_SOURCE';
  return process.env[key]?.trim().toLowerCase() === 'live' ? 'live' : 'mock';
}

export interface LiveGammaReading {
  mode: TastySourceMode;
  symbol: string;
  /** Epoch ms of the newest underlying event the reading is built on. */
  asOfMs: number | null;
  /** `Oct 22, 2026, 14:05 ET` for server-rendered stamps. */
  asOfLabel: string | null;
  gex: GexResult | null;
  /** The same shape the public positioning summary has, for the Dashboard cards. */
  summary: Summary | null;
  /**
   * The whole reading in the public `PositioningData` shape, so the existing
   * gamma panels (hero, gamma map, levels, exposure tables) render it as-is.
   * GEX here is the feed formula (per $1 move); vanna and charm are not on the
   * feed and are zero.
   */
  positioning: PositioningData | null;
  error: string | null;
}

function toSummary(gex: GexResult): Summary {
  const m = magnets(gex);
  return {
    spot: gex.spot,
    netGex: gex.netGex,
    regime: gex.netGex >= 0 ? 'positive' : 'negative',
    flipLevel: gex.zeroGamma,
    frontFlipLevel: null,
    frontExpiration: null,
    magnetAbove: m.above,
    magnetBelow: m.below,
    totalCallOi: gex.totalCallOi,
    totalPutOi: gex.totalPutOi,
    putCallOiRatio: gex.totalCallOi > 0 ? gex.totalPutOi / gex.totalCallOi : null,
    atmIv: gex.atmIv,
  };
}

/**
 * Live (or mock) spot and gamma for `symbol`.
 *
 * `referencePrice` only anchors the mock's spot; without one the mock anchors on
 * the production spot quote. The live path ignores both.
 */
export async function getLiveGamma(symbol: string, referencePrice?: number | null): Promise<LiveGammaReading> {
  const mode = tastySourceMode();
  const upper = symbol.trim().toUpperCase();

  let snapshot;
  let error: string | null = null;
  if (mode === 'live') {
    try {
      // Imported lazily so a mock deploy never even loads the socket client.
      const { liveSnapshot } = await import('./dxlink');
      ({ snapshot, error } = await liveSnapshot(upper));
    } catch (e) {
      return {
        mode,
        symbol: upper,
        asOfMs: null,
        asOfLabel: null,
        gex: null,
        summary: null,
        positioning: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  } else {
    // Anchor the mock on the production spot quote (Cboe) when it answers, so
    // mock levels land around the real price on the real chart. Still mock.
    const reference = referencePrice ?? (await getSpotQuote(upper).catch(() => null))?.price ?? null;
    snapshot = mockSnapshot(upper, Date.now(), reference);
  }

  const gex = computeGex(snapshot);
  const underlying = snapshot.states.get(upper);
  const asOfMs = underlying?.receivedAt ?? null;
  const summary = gex ? toSummary(gex) : null;
  return {
    mode,
    symbol: upper,
    asOfMs,
    asOfLabel: asOfMs ? formatAsOf(new Date(asOfMs)) : null,
    gex,
    summary,
    positioning: gex && summary && asOfMs ? toPositioning(snapshot, gex, summary, mode, asOfMs) : null,
    error: gex ? error : (error ?? 'No gamma could be built from the feed.'),
  };
}

function emptyMetrics(): Metrics {
  return { gex: 0, vex: 0, cex: 0, oi: 0, callGex: 0, putGex: 0, callOi: 0, putOi: 0 };
}

function addInto(target: Metrics, m: Metrics): void {
  target.gex += m.gex;
  target.oi += m.oi;
  target.callGex += m.callGex;
  target.putGex += m.putGex;
  target.callOi += m.callOi;
  target.putOi += m.putOi;
}

/**
 * The feed reading in the public `PositioningData` shape: one row per strike
 * (highest first, as the public builder emits them), one cell per expiration.
 * Put GEX is stored negative and `gex` is call + put, the public convention, so
 * the row totals equal `GexStrike.netGex`.
 */
function toPositioning(
  snapshot: FeedSnapshot,
  gex: GexResult,
  summary: Summary,
  mode: TastySourceMode,
  asOfMs: number,
): PositioningData {
  const now = new Date(asOfMs);
  const expirations = [...new Set(snapshot.options.map((o) => o.expiration))].sort();
  const column = new Map(expirations.map((e, i) => [e, i]));
  const rows = new Map<number, StrikeRow>();
  let used = 0;

  for (const ref of snapshot.options) {
    const state = snapshot.states.get(ref.streamerSymbol);
    const gamma = state?.greeks?.gamma;
    const oi = state?.summary?.openInterest;
    if (typeof gamma !== 'number' || !Number.isFinite(gamma) || typeof oi !== 'number' || !Number.isFinite(oi) || oi < 0) {
      continue;
    }
    used += 1;
    const value = gamma * oi * 100 * gex.spot;
    const row = rows.get(ref.strike) ?? {
      strike: ref.strike,
      cells: expirations.map(() => emptyMetrics()),
      total: emptyMetrics(),
    };
    const cell = row.cells[column.get(ref.expiration)!];
    const m = emptyMetrics();
    if (ref.type === 'call') {
      m.callGex = value;
      m.callOi = oi;
      m.oi = oi;
    } else {
      m.putGex = -value;
      m.putOi = oi;
      m.oi = -oi;
    }
    m.gex = m.callGex + m.putGex;
    addInto(cell, m);
    addInto(row.total, m);
    rows.set(ref.strike, row);
  }

  const ordered = [...rows.values()].sort((a, b) => b.strike - a.strike);
  const columnTotals = expirations.map(() => emptyMetrics());
  const grandTotal = emptyMetrics();
  for (const row of ordered) {
    row.cells.forEach((c, i) => addInto(columnTotals[i], c));
    addInto(grandTotal, row.total);
  }

  const label = formatAsOf(now);
  const sourceLabel = mode === 'mock' ? 'Tastytrade (MOCK — not live)' : 'Tastytrade dxLink';
  return {
    symbol: snapshot.underlying,
    spot: gex.spot,
    expirations,
    expirationMeta: expirations.map((date) => ({
      date,
      label: formatExpiryLabel(date),
      dte: daysToExpiry(date, now),
    })),
    rows: ordered,
    columnTotals,
    grandTotal,
    summary,
    meta: {
      source: 'tastytrade',
      sourceLabel,
      asOfLabel: label,
      asOfIso: now.toISOString(),
      quoteDateLabel: label,
      quoteDateIso: now.toISOString(),
      cacheSeconds: 0,
      upstreamRequests: 0,
      contractsUsed: used,
      ivSources: { quoted: used, solved: 0, model: 0 },
      riskFreeRate: 0,
      dividendYield: 0,
      notes: [
        `${sourceLabel}: gamma from the feed's Greeks events, open interest from its Summary events. GEX = gamma × OI × 100 × spot (per $1 move), not the public per-1% figure. Vanna and charm are not on the feed and read zero.`,
      ],
    },
  };
}
