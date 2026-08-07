import 'server-only';

import { config } from '../config';
import { addDays, marketToday } from '../time';
import type { Bar } from './types';

/**
 * Daily bars for an arbitrary US ticker.
 *
 * Polygon is preferred: it is a supported, paid API returning split- and
 * dividend-adjusted bars. Yahoo's chart endpoint is the fallback for when
 * Polygon rate-limits or does not cover the symbol.
 *
 * Stooq was evaluated and rejected — it now answers with a JavaScript bot
 * challenge rather than CSV.
 */

export class TickerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'TickerError';
  }
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * Symbols reach this module from a user-controlled search box and are
 * interpolated into upstream URLs, so they are validated against a strict
 * allow-list rather than escaped. Covers ordinary tickers plus class shares
 * (`BRK.B`, `BF-B`).
 */
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z]{1,2})?$/;

export function normaliseSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

interface PolygonAggsResponse {
  status?: string;
  resultsCount?: number;
  results?: Array<{ t?: number; o?: number; h?: number; l?: number; c?: number; v?: number }>;
  error?: string;
  message?: string;
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fromPolygon(symbol: string): Promise<Bar[] | null> {
  const key = config.apiKey;
  if (!key) return null;

  const to = marketToday();
  const from = addDays(to, -400);

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=500&apiKey=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: config.tickerCacheSeconds },
  });

  if (res.status === 429) return null; // fall through to Yahoo
  if (!res.ok) return null;

  const body = (await res.json()) as PolygonAggsResponse;
  if (!Array.isArray(body.results) || body.results.length === 0) return null;

  const bars: Bar[] = [];
  for (const r of body.results) {
    if (
      typeof r.t !== 'number' || typeof r.o !== 'number' || typeof r.h !== 'number' ||
      typeof r.l !== 'number' || typeof r.c !== 'number'
    ) {
      continue;
    }
    bars.push({
      date: isoFromMs(r.t),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: typeof r.v === 'number' ? r.v : 0,
    });
  }

  return bars.length > 0 ? bars : null;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; longName?: string; shortName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose?: (number | null)[] }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

async function fromYahoo(
  symbol: string,
): Promise<{ bars: Bar[]; name?: string } | null> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`,
    {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      next: { revalidate: config.tickerCacheSeconds },
    },
  );
  if (!res.ok) return null;

  const body = (await res.json()) as YahooChartResponse;
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!stamps || !quote) return null;

  const bars: Bar[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    // Yahoo pads holidays and halts with nulls; drop those rows entirely
    // rather than carrying a previous close forward.
    if (
      typeof o !== 'number' || typeof h !== 'number' ||
      typeof l !== 'number' || typeof c !== 'number'
    ) {
      continue;
    }
    bars.push({
      date: isoFromMs(stamps[i] * 1000),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: typeof quote.volume?.[i] === 'number' ? (quote.volume[i] as number) : 0,
    });
  }

  if (bars.length === 0) return null;
  return { bars, name: result?.meta?.longName ?? result?.meta?.shortName };
}

export interface BarSeries {
  bars: Bar[];
  source: 'polygon' | 'yahoo';
  name?: string;
}

export interface FetchBarsOptions {
  /**
   * Which upstream to try first.
   *
   * Polygon is the better source — supported and split-adjusted — but its
   * stocks quota is 5 requests per minute even on a paid options plan
   * (measured: a burst of 14 returned nine 429s). So anything that fans out
   * over many symbols must pass `prefer: 'yahoo'`, which absorbed 20
   * concurrent requests in under a second with no failures.
   */
  prefer?: 'polygon' | 'yahoo';
  /** Company name costs an extra request when Polygon served the bars. */
  withName?: boolean;
}

/** Roughly a year of daily bars, oldest first. */
export async function fetchBars(
  symbol: string,
  options: FetchBarsOptions = {},
): Promise<BarSeries> {
  const { prefer = 'polygon', withName = true } = options;

  if (prefer === 'yahoo') {
    const first = await fromYahoo(symbol).catch(() => null);
    if (first && first.bars.length >= 60) {
      return { bars: first.bars, source: 'yahoo', name: first.name };
    }
  }

  const polygon =
    prefer === 'polygon' ? await fromPolygon(symbol).catch(() => null) : null;

  if (polygon && polygon.length >= 60) {
    // Yahoo is consulted only for the company name, and only cheaply — a
    // failure here must not break an otherwise good result.
    const meta = withName ? await fromYahoo(symbol).catch(() => null) : null;
    return { bars: polygon, source: 'polygon', name: meta?.name };
  }

  const yahoo = await fromYahoo(symbol).catch(() => null);
  if (yahoo && yahoo.bars.length >= 60) {
    return { bars: yahoo.bars, source: 'yahoo', name: yahoo.name };
  }

  if (polygon || yahoo) {
    throw new TickerError(
      `Not enough price history for ${symbol}.`,
      422,
      'At least 60 trading days are needed to compute the signals.',
    );
  }

  throw new TickerError(
    `No price data found for ${symbol}.`,
    404,
    'Check the symbol. Only US-listed equities and ETFs are supported.',
  );
}
