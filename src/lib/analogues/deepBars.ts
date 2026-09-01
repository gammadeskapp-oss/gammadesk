import 'server-only';

import { normaliseSymbol, TickerError } from '../ticker/bars';
import type { Bar, Coverage } from './types';

/**
 * As much daily history as the existing quote source will give.
 *
 * ## Why this does not just call `fetchBars`
 *
 * Same upstream, different query. `fetchBars` asks Yahoo with a `range` token,
 * and Yahoo answers `range=max&interval=1d` with **monthly** bars — 404 rows
 * for SPY instead of 8,453, with `dataGranularity: "1mo"` in the response and
 * no error anywhere. Nothing rejects them, because monthly OHLC is perfectly
 * well-formed daily-looking OHLC. An analogue engine fed those would report
 * that SPY has closed lower three months running about ninety times since 1993
 * and label it three days.
 *
 * The `period1`/`period2` form has no such downgrade and returns the full
 * daily series. So this module uses it, and `bars.ts` no longer asks for
 * `max` at all.
 *
 * This is not a new data source: it is the Yahoo chart endpoint the app
 * already depends on, asked a different way. Polygon is not used here — the
 * stocks quota is five requests a minute, and this needs decades rather than
 * freshness.
 *
 * ## What the prices are adjusted for
 *
 * Yahoo's `close` is **split-adjusted but not dividend-adjusted**; `adjclose`
 * is both. Measured on the SPY series: the 1993 raw close is 1.82x its
 * adjusted close, which is dividends alone — SPY's three 2:1 splits are
 * already in the raw field, or the ratio would be near 8x. Checked across
 * seventeen symbols including five AAPL splits and nine MSFT splits, the
 * largest single-session close-to-close jump anywhere was a real market move,
 * so no split is missing from the raw series.
 *
 * The conditions run on `close`. RSI, the 200-day, the Bollinger band and a
 * consecutive-down streak are all read off the split-adjusted price in every
 * chart anyone would compare this against; recomputing them on a
 * dividend-adjusted series would put a small upward drift into every
 * indicator and match dates would stop agreeing with any chart. The forward
 * returns therefore exclude dividends too, and are price returns — which the
 * page says.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** More than this many calendar days between sessions is worth naming. */
const GAP_DAYS = 5;

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { dataGranularity?: string };
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
  };
}

function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** Shortest series worth running the engine over: roughly two years. */
const MIN_BARS = 500;

export interface DeepSeries {
  bars: Bar[];
  coverage: Coverage;
}

export async function fetchDeepBars(rawSymbol: string): Promise<DeepSeries> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) {
    throw new TickerError(`${rawSymbol} is not a valid ticker.`, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` +
    `?period1=0&period2=${now}&interval=1d`;

  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    // A day of history changes once a day. An hour is generous and keeps a
    // page reload from re-fetching decades of bars.
    next: { revalidate: 3600 },
  }).catch(() => null);

  /*
   * 404 is Yahoo's answer for a symbol it has no chart for, which is a fact
   * about the ticker. Every other bad status is a fact about the request, and
   * telling a reader who mistyped a symbol that the feed is down would send
   * them to wait for an outage that is not happening.
   */
  if (res && res.status === 404) {
    throw new TickerError(
      `No price history found for ${symbol}.`,
      404,
      'Check the symbol. Only US-listed equities and ETFs are covered.',
    );
  }

  if (!res || !res.ok) {
    throw new TickerError(
      `Could not reach the price history for ${symbol}.`,
      502,
      'The quote source did not answer. Try again shortly.',
    );
  }

  const body = (await res.json()) as YahooChartResponse;
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];

  if (!stamps || !quote) {
    throw new TickerError(
      `No price history found for ${symbol}.`,
      404,
      'Only US-listed equities and ETFs are covered.',
    );
  }

  /*
   * The granularity is checked rather than assumed. If Yahoo ever downgrades
   * this query the way it downgrades `range=max`, the engine must stop, not
   * quietly relabel monthly bars as sessions.
   */
  const granularity = result.meta?.dataGranularity;
  if (granularity && granularity !== '1d') {
    throw new TickerError(
      `The quote source returned ${granularity} bars for ${symbol}, not daily.`,
      502,
      'Daily bars are required. This is an upstream change, not a bad ticker.',
    );
  }

  const bars: Bar[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    // Halts and holidays come back as nulls. Dropped, never carried forward —
    // a repeated close would read as an unchanged day and break the streaks.
    if (
      typeof o !== 'number' || typeof h !== 'number' ||
      typeof l !== 'number' || typeof c !== 'number'
    ) {
      continue;
    }
    bars.push({
      date: isoFromSeconds(stamps[i]),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: typeof quote.volume?.[i] === 'number' ? (quote.volume[i] as number) : 0,
    });
  }

  if (bars.length < MIN_BARS) {
    throw new TickerError(
      `${symbol} has only ${bars.length} daily bars stored.`,
      422,
      `At least ${MIN_BARS} are needed before a historical count means anything.`,
    );
  }

  const gaps: Coverage['gaps'] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const days = daysBetween(bars[i - 1].date, bars[i].date);
    if (days > GAP_DAYS) {
      gaps.push({ from: bars[i - 1].date, to: bars[i].date, days });
    }
  }

  const first = bars[0].date;
  const last = bars[bars.length - 1].date;

  return {
    bars,
    coverage: {
      symbol,
      source: 'yahoo',
      bars: bars.length,
      firstDate: first,
      lastDate: last,
      years: Math.round((daysBetween(first, last) / 365.25) * 10) / 10,
      gaps,
      adjustment: 'split-only',
    },
  };
}
