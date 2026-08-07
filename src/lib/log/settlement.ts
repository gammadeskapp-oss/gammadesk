import 'server-only';

import { config } from '../config';

/** A settled daily bar for the underlying. */
export interface DailyBar {
  open: number;
  high: number;
  low: number;
  close: number;
  from: 'polygon' | 'cboe';
}

interface OpenCloseResponse {
  status?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  message?: string;
}

/**
 * Polygon's daily open/close. Verified to work on the free plan, and it is
 * historical, so a day missed by the cron can still be settled later.
 * This is the preferred source.
 */
async function fromPolygon(symbol: string, date: string): Promise<DailyBar | null> {
  const key = config.apiKey;
  if (!key) return null;

  const url = new URL(
    `https://api.polygon.io/v1/open-close/${encodeURIComponent(symbol)}/${date}`,
  );
  url.searchParams.set('adjusted', 'true');
  url.searchParams.set('apiKey', key);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  // 404 means the market was shut that day, or the bar is not published yet.
  if (!res.ok) return null;

  const body = (await res.json()) as OpenCloseResponse;
  if (body.status !== 'OK') return null;

  const { open, high, low, close } = body;
  if (
    typeof open !== 'number' || typeof high !== 'number' ||
    typeof low !== 'number' || typeof close !== 'number'
  ) {
    return null;
  }

  return { open, high, low, close, from: 'polygon' };
}

interface CboeUnderlying {
  data?: {
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    current_price?: number;
    last_trade_time?: string;
  };
}

/**
 * Cboe's own session OHLC for the underlying, taken from the same payload the
 * dashboard already uses.
 *
 * This only describes the CURRENT session, so it can settle today after the
 * close but can never backfill an older day. Used when no Polygon key is
 * configured.
 */
async function fromCboe(symbol: string, date: string): Promise<DailyBar | null> {
  const res = await fetch(
    `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) return null;

  const body = (await res.json()) as CboeUnderlying;
  const d = body.data;
  if (!d) return null;

  // Only trust it if the feed's last trade really is the day being settled.
  const tradedOn = d.last_trade_time?.slice(0, 10);
  if (tradedOn !== date) return null;

  const open = d.open;
  const high = d.high;
  const low = d.low;
  const close = d.close ?? d.current_price;

  if (
    typeof open !== 'number' || typeof high !== 'number' ||
    typeof low !== 'number' || typeof close !== 'number' ||
    high <= 0 || low <= 0
  ) {
    return null;
  }

  return { open, high, low, close, from: 'cboe' };
}

/**
 * Daily bar for `date` (`YYYY-MM-DD`), or null when the market was closed or
 * the data is not published yet. Null is not an error — the caller leaves the
 * day unsettled and retries on the next run.
 */
export async function fetchDailyBar(date: string): Promise<DailyBar | null> {
  const symbol = config.symbol;

  const polygon = await fromPolygon(symbol, date).catch(() => null);
  if (polygon) return polygon;

  return fromCboe(symbol, date).catch(() => null);
}
