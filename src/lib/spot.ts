import 'server-only';

import { cached } from './cache';
import { config } from './config';
import { fetchPolygonSpot } from './polygon';
import { fetchCboeQuote } from './x/cboeQuote';

/**
 * A live spot price, on a short cache, decoupled from the option chain.
 *
 * ## Why this is separate from `getPositioning`
 *
 * The chain snapshot is deliberately cached for many minutes (`cacheSeconds`):
 * pulling and re-computing the whole book on every request is expensive, and the
 * levels it produces — the gamma flip, the walls — barely move within a window.
 * The *price* those levels are measured against does move, though, so a chain
 * that is thirty minutes old leaves the page and the X posts quoting a
 * thirty-minute-old SPY. This fills that gap: one light request per
 * `spotCacheSeconds` window per symbol — a single options-snapshot page (spot
 * echoed, or derived by put-call parity), or the Cboe compact quote — with no
 * pagination and no gamma math. The caller overlays it on the displayed price
 * while the cached chain keeps supplying the stable levels.
 *
 * `changePct` and the session range are populated only when the source carries
 * them: the Cboe compact quote does; a pure Polygon *options* plan does not echo
 * an underlying previous close, so on that plan those come back null and the
 * caller keeps whatever it already had for them.
 */
export interface SpotQuote {
  price: number;
  asOfIso: string;
  /** Fractional day change, or null when the source cannot supply one. */
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  source: 'polygon' | 'cboe';
}

async function loadSpot(symbol: string): Promise<SpotQuote> {
  if (config.dataSource === 'polygon' && config.apiKey) {
    const { price, asOf } = await fetchPolygonSpot(symbol);
    return {
      price,
      asOfIso: asOf.toISOString(),
      changePct: null,
      dayHigh: null,
      dayLow: null,
      source: 'polygon',
    };
  }

  const q = await fetchCboeQuote(symbol);
  return {
    price: q.price,
    asOfIso: q.quoteIso,
    changePct: q.changePct,
    dayHigh: q.dayHigh,
    dayLow: q.dayLow,
    source: 'cboe',
  };
}

/**
 * A short-cached live spot for `symbol`, or null when it could not be read.
 *
 * Never throws: a failed spot fetch must not take down a page or block an X
 * post — the caller falls back to the chain snapshot's own (older) spot. The
 * failure is not cached, so the next request tries again.
 */
export async function getSpotQuote(symbol: string): Promise<SpotQuote | null> {
  try {
    return await cached(`spot:${config.dataSource}:${symbol}`, config.spotCacheSeconds, () =>
      loadSpot(symbol),
    );
  } catch {
    return null;
  }
}
