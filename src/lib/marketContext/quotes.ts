import 'server-only';

import { cached } from '../cache';
import { fetchSparks } from '../breadth/spark';

/**
 * The four readings in the home page's context row.
 *
 * ## Why this reuses the breadth module's fetcher
 *
 * `fetchSparks` already solves exactly this problem — many symbols, one
 * request, prices and prior closes — and it carries the notes explaining why
 * Yahoo's documented batch quote route is unusable (HTTP 401) and spark is
 * not. Writing a second quote client here would have meant a second set of
 * those discoveries to keep current, and the two would have disagreed the
 * first time Yahoo changed something.
 *
 * Four symbols is one chunk, so this is one upstream request per cache period.
 */

/** Shown left to right, in that order. */
export const CONTEXT_SYMBOLS = ['SPY', 'QQQ', 'IWM', '^VIX'] as const;

export type ContextSymbol = (typeof CONTEXT_SYMBOLS)[number];

/** What the row labels each symbol. `^VIX` is Yahoo's spelling, not a label. */
export const CONTEXT_LABELS: Record<ContextSymbol, string> = {
  SPY: 'SPY',
  QQQ: 'QQQ',
  IWM: 'IWM',
  '^VIX': 'VIX',
};

export interface Quote {
  symbol: ContextSymbol;
  label: string;
  price: number;
  changePct: number;
}

export interface MarketContextQuotes {
  quotes: Quote[];
  /** Symbols the fetch could not resolve. Named, never silently dropped. */
  missing: ContextSymbol[];
  at: string;
}

/**
 * Cached for a minute.
 *
 * The home page is `force-dynamic`, so without this every visit is an upstream
 * request. A minute is short enough that the row is not visibly behind the
 * quote a reader has open elsewhere, and long enough that a burst of traffic
 * costs one fetch.
 */
const CACHE_SECONDS = 60;

export function getMarketContextQuotes(): Promise<MarketContextQuotes> {
  return cached('context:quotes', CACHE_SECONDS, async () => {
    const { series } = await fetchSparks([...CONTEXT_SYMBOLS], {
      // One chunk, four symbols. A short timeout because this row is context
      // beside the levels, and a slow quote feed must not hold up the page
      // the reader actually came for.
      timeoutMs: 6_000,
    });

    const quotes: Quote[] = [];
    const missing: ContextSymbol[] = [];

    for (const symbol of CONTEXT_SYMBOLS) {
      const spark = series.get(symbol);
      const last = spark?.closes[spark.closes.length - 1];

      if (!spark || last === undefined || !(spark.previousClose > 0)) {
        missing.push(symbol);
        continue;
      }

      quotes.push({
        symbol,
        label: CONTEXT_LABELS[symbol],
        price: last,
        changePct: ((last - spark.previousClose) / spark.previousClose) * 100,
      });
    }

    return { quotes, missing, at: new Date().toISOString() };
  });
}
