import 'server-only';

import type { Summary } from '../types';
import { formatAsOf } from '../time';
import { computeGex, magnets } from './gex';
import { mockSnapshot } from './mock';
import type { GexResult, TastySourceMode } from './types';

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
 * `referencePrice` only anchors the mock's spot (e.g. the Ticker tab passes the
 * last close it already has); the live path ignores it.
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
        error: e instanceof Error ? e.message : String(e),
      };
    }
  } else {
    snapshot = mockSnapshot(upper, Date.now(), referencePrice);
  }

  const gex = computeGex(snapshot);
  const underlying = snapshot.states.get(upper);
  const asOfMs = underlying?.receivedAt ?? null;
  return {
    mode,
    symbol: upper,
    asOfMs,
    asOfLabel: asOfMs ? formatAsOf(new Date(asOfMs)) : null,
    gex,
    summary: gex ? toSummary(gex) : null,
    error: gex ? error : (error ?? 'No gamma could be built from the feed.'),
  };
}
