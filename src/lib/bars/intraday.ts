import 'server-only';

import { cached } from '../cache';
import { formatAsOf } from '../time';
import type { ChartBar, Timeframe } from './types';

export { TIMEFRAMES, isTimeframe } from './types';
export type { ChartBar, Timeframe } from './types';

/**
 * Intraday and daily bars for the interactive chart.
 *
 * Yahoo's chart endpoint serves every timeframe the chart offers natively,
 * including 4h — which is worth stating because it is easy to assume otherwise
 * and build an hourly-to-4h aggregator that is not needed. Verified: `4h`
 * returns `dataGranularity: "4h"`.
 *
 * Each interval has its own maximum lookback, enforced by Yahoo rather than by
 * us; asking for a year of one-minute bars returns an error, not a year of
 * bars. The ranges below are the largest each interval actually serves.
 */

interface TimeframeSpec {
  /** Yahoo's interval token. */
  interval: string;
  /** Yahoo's range token. The most history this interval will serve. */
  range: string;
  /** Server cache, in seconds. */
  ttl: number;
  /** Whether VWAP means anything here. It resets each session. */
  intraday: boolean;
  label: string;
}

export const TIMEFRAME_SPEC: Record<Timeframe, TimeframeSpec> = {
  // Yahoo caps one-minute history at roughly a week.
  '1m': { interval: '1m', range: '5d', ttl: 60, intraday: true, label: '1 minute' },
  '5m': { interval: '5m', range: '1mo', ttl: 120, intraday: true, label: '5 minute' },
  '15m': { interval: '15m', range: '1mo', ttl: 120, intraday: true, label: '15 minute' },
  '1h': { interval: '1h', range: '3mo', ttl: 300, intraday: true, label: '1 hour' },
  '4h': { interval: '4h', range: '6mo', ttl: 300, intraday: true, label: '4 hour' },
  '1D': { interval: '1d', range: '2y', ttl: 900, intraday: false, label: 'daily' },
};

export interface BarSeriesResult {
  symbol: string;
  timeframe: Timeframe;
  bars: ChartBar[];
  /** True when VWAP is meaningful for this timeframe. */
  intraday: boolean;
  asOfLabel: string;
  /** New York time zone offset handling is Yahoo's; recorded for the caller. */
  exchangeTimezone: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { exchangeTimezoneName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

async function fetchBars(symbol: string, timeframe: Timeframe): Promise<BarSeriesResult> {
  const spec = TIMEFRAME_SPEC[timeframe];

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${spec.range}&interval=${spec.interval}&includePrePost=false`;

  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`Yahoo returned HTTP ${response.status}`);

  const body = (await response.json()) as YahooChart;
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];

  if (!stamps || !quote) {
    throw new Error(body.chart?.error?.description ?? 'No bars returned');
  }

  const bars: ChartBar[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    // Yahoo pads halts and gaps with nulls. Dropped rather than carried
    // forward, which would draw a flat candle that never traded.
    if (
      typeof o !== 'number' || typeof h !== 'number' ||
      typeof l !== 'number' || typeof c !== 'number'
    ) {
      continue;
    }
    bars.push({
      t: stamps[i],
      o,
      h,
      l,
      c,
      v: typeof quote.volume?.[i] === 'number' ? (quote.volume[i] as number) : 0,
    });
  }

  if (bars.length === 0) throw new Error('No usable bars returned');

  return {
    symbol,
    timeframe,
    bars,
    intraday: spec.intraday,
    asOfLabel: formatAsOf(new Date(bars[bars.length - 1].t * 1000)),
    exchangeTimezone: result?.meta?.exchangeTimezoneName ?? 'America/New_York',
  };
}

/**
 * Cached per symbol and timeframe.
 *
 * Quotes are delayed a quarter of an hour, so a cache measured in a minute or
 * two costs the viewer nothing they could have seen anyway, and keeps a user
 * flicking between timeframes from becoming a burst of upstream requests.
 */
export function getBars(symbol: string, timeframe: Timeframe): Promise<BarSeriesResult> {
  return cached(`bars:${symbol}:${timeframe}`, TIMEFRAME_SPEC[timeframe].ttl, () =>
    fetchBars(symbol, timeframe),
  );
}
