import 'server-only';

import { cached } from '../cache';
import { config } from '../config';
import { formatAsOf } from '../time';
import { fetchBars, normaliseSymbol, TickerError } from './bars';
import { sma } from './indicators';
import { assessLiquidity } from './liquidity';
import { computeSignals } from './signals';
import {
  consensusOf,
  type Bar,
  type ChartPoint,
  type TickerAnalysis,
  type TickerChartData,
} from './types';

/** Align an indicator series to its bars, dropping the undefined leading run. */
function toPoints(bars: Bar[], series: (number | null)[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const value = series[i];
    if (value !== null && value !== undefined) {
      out.push({ time: bars[i].date, value });
    }
  }
  return out;
}

/**
 * Chart-ready series.
 *
 * Trimmed to roughly a year so the payload stays small — the bar series runs
 * about 275 sessions, and the extra tail exists only to seed the 200-day
 * average, not to be drawn. The averages are computed over the FULL series
 * first and trimmed afterwards, so the 200-day line is correct from the very
 * first candle shown rather than starting 200 sessions in.
 */
function buildChart(bars: Bar[]): TickerChartData {
  const closes = bars.map((b) => b.close);
  const ma50All = toPoints(bars, sma(closes, 50));
  const ma200All = toPoints(bars, sma(closes, 200));

  const visible = bars.slice(-252);
  const firstDate = visible[0]?.date ?? '';

  return {
    candles: visible.map((b) => ({
      time: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    })),
    ma50: ma50All.filter((p) => p.time >= firstDate),
    ma200: ma200All.filter((p) => p.time >= firstDate),
  };
}

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
      chart: buildChart(bars),
      high52: Math.max(...window.map((b) => b.high)),
      low52: Math.min(...window.map((b) => b.low)),
      cachedForSeconds: config.tickerCacheSeconds,
    } satisfies TickerAnalysis;
  });
}
