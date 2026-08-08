import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { fetchBars, normaliseSymbol } from './bars';
import { computeSignals } from './signals';

/**
 * A ticker's signal score without the extras.
 *
 * `analyzeTicker` also pulls the whole listed option chain to rate liquidity,
 * which is several megabytes per symbol — far too heavy for a watchlist of
 * twenty. This path fetches daily bars only, and goes to Yahoo because
 * Polygon's stocks quota is five requests a minute.
 */

export interface QuickScore {
  symbol: string;
  ok: true;
  price: number;
  changePct: number;
  bullish: number;
  total: number;
  vote: 'bullish' | 'bearish';
  momentum20: number;
}

export interface QuickScoreFailure {
  symbol: string;
  ok: false;
  reason: string;
}

export type QuickScoreResult = QuickScore | QuickScoreFailure;

/** Symbols fetched at once — Yahoo absorbed 20 concurrently without complaint. */
const WAVE = 5;

async function scoreOne(symbol: string): Promise<QuickScoreResult> {
  return cached(`quickscore:${symbol}`, config.tickerCacheSeconds, async () => {
    try {
      const { bars } = await fetchBars(symbol, { prefer: 'yahoo', withName: false });
      if (bars.length < 60) {
        return { symbol, ok: false as const, reason: 'Not enough price history.' };
      }

      const signals = computeSignals(bars);
      const bullish = signals.filter((s) => s.vote === 'bullish').length;
      const last = bars[bars.length - 1];
      const prev = bars[bars.length - 2] ?? last;
      const lookback = Math.min(20, bars.length - 1);
      const then = bars[bars.length - 1 - lookback]?.close ?? last.close;

      return {
        symbol,
        ok: true as const,
        price: last.close,
        changePct: prev.close > 0 ? last.close / prev.close - 1 : 0,
        bullish,
        total: signals.length,
        vote: (bullish * 2 >= signals.length ? 'bullish' : 'bearish') as 'bullish' | 'bearish',
        momentum20: then > 0 ? last.close / then - 1 : 0,
      };
    } catch (error) {
      return {
        symbol,
        ok: false as const,
        reason: error instanceof Error ? error.message : 'Lookup failed.',
      };
    }
  });
}

export async function scoreSymbols(raw: string[]): Promise<QuickScoreResult[]> {
  const symbols = [...new Set(raw.map((s) => s.trim().toUpperCase()))]
    .filter((s) => normaliseSymbol(s) !== null)
    .slice(0, 30);

  const out: QuickScoreResult[] = [];
  for (let i = 0; i < symbols.length; i += WAVE) {
    out.push(...(await Promise.all(symbols.slice(i, i + WAVE).map(scoreOne))));
  }
  return out;
}
