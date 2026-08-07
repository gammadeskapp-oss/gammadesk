import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { formatAsOf } from '../time';
import { fetchBars, normaliseSymbol, TickerError } from './bars';
import { assessLiquidity } from './liquidity';
import { computeSignals } from './signals';
import { consensusOf, type TickerAnalysis } from './types';

export { TickerError, normaliseSymbol };

/**
 * Full consensus for one ticker.
 *
 * Cached per symbol for `GAMMADESK_TICKER_CACHE_SECONDS`, sharing the same
 * single-flight cache the dashboard uses, so repeated searches for the same
 * name cost nothing upstream.
 */
export async function analyzeTicker(rawSymbol: string): Promise<TickerAnalysis> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) {
    throw new TickerError(
      `"${rawSymbol.slice(0, 12)}" is not a valid ticker.`,
      400,
      'Use a US listing such as AAPL, NVDA or BRK.B.',
    );
  }

  return cached(`ticker:${symbol}`, config.tickerCacheSeconds, async () => {
    const { bars, source, name } = await fetchBars(symbol);

    const signals = computeSignals(bars);
    const consensus = consensusOf(signals);
    const liquidity = await assessLiquidity(symbol, bars);

    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2] ?? last;
    const window = bars.slice(-252);

    return {
      symbol,
      name,
      price: last.close,
      changePct: prev.close > 0 ? last.close / prev.close - 1 : 0,
      asOfDate: last.date,
      asOfLabel: formatAsOf(new Date(`${last.date}T20:00:00Z`)),
      barsUsed: bars.length,
      source,
      signals,
      consensus,
      liquidity,
      high52: Math.max(...window.map((b) => b.high)),
      low52: Math.min(...window.map((b) => b.low)),
      cachedForSeconds: config.tickerCacheSeconds,
    } satisfies TickerAnalysis;
  });
}
