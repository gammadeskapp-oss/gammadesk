import 'server-only';

import { config, POLYGON_LIMITS } from './config';
import {
  ChainError,
  resolveIvSurface,
  trimToWindow,
  type ChainSnapshot,
  type RawQuote,
} from './chainSource';
import { polygonLimiter } from './rateLimit';
import { addDays, marketToday } from './time';
import type { OptionType } from './types';

/**
 * Polygon.io options-chain adapter.
 *
 * NOTE ON PLAN ENTITLEMENT: the endpoints below are NOT included in Polygon's
 * free plan. `/v3/snapshot/options/{underlying}` returns 403 NOT_AUTHORIZED
 * there, and open interest — which every figure on this dashboard derives from
 * — is not exposed by any free endpoint. `/v3/reference/options/contracts`
 * gives strikes and expiries but no open interest, and per-contract aggregates
 * give volume but no open interest.
 *
 * This adapter is therefore only useful on a paid options plan. Select it with
 * `GAMMADESK_DATA_SOURCE=polygon`; the default is Cboe, which serves the same
 * data for free. See `cboe.ts`.
 */

const BASE = 'https://api.polygon.io';

interface PrevCloseResponse {
  results?: Array<{ c?: number; t?: number }>;
}

interface SnapshotResult {
  details?: {
    contract_type?: string;
    expiration_date?: string;
    strike_price?: number;
    ticker?: string;
  };
  implied_volatility?: number;
  open_interest?: number;
  day?: { close?: number };
  last_quote?: { bid?: number; ask?: number; midpoint?: number };
  last_trade?: { price?: number };
  underlying_asset?: { price?: number };
}

interface SnapshotResponse {
  results?: SnapshotResult[];
  next_url?: string;
  error?: string;
  message?: string;
}

/**
 * Every outbound call funnels through here so the rate limiter, the request
 * counter and the error translation stay in one place.
 */
async function polygonFetch<T>(url: string, counter: { count: number }): Promise<T> {
  const key = config.apiKey;
  if (!key) {
    throw new ChainError(
      'POLYGON_API_KEY is not set.',
      0,
      'Add it to .env.local locally, and to Project Settings -> Environment Variables on Vercel.',
    );
  }

  const target = new URL(url, BASE);
  target.searchParams.set('apiKey', key);

  await polygonLimiter(POLYGON_LIMITS.requestsPerMinute).acquire();
  counter.count += 1;

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      headers: { Accept: 'application/json' },
      next: { revalidate: config.cacheSeconds },
    });
  } catch (cause) {
    throw new ChainError(
      'Could not reach the Polygon API.',
      0,
      cause instanceof Error ? cause.message : undefined,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ChainError(
      `Polygon rejected the request (HTTP ${response.status}).`,
      response.status,
      'The options snapshot endpoint is not included in the free plan — open interest is unavailable there. Use GAMMADESK_DATA_SOURCE=cboe, or upgrade the Polygon plan.',
    );
  }
  if (response.status === 429) {
    throw new ChainError(
      'Polygon rate limit hit (HTTP 429).',
      429,
      'The free plan allows 5 requests per minute. Wait a minute and refresh.',
    );
  }
  if (!response.ok) {
    throw new ChainError(`Polygon returned HTTP ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

/** Previous session's closing price for the underlying. Costs one request. */
async function fetchSpot(
  symbol: string,
  counter: { count: number },
): Promise<{ price: number; asOf: Date }> {
  const data = await polygonFetch<PrevCloseResponse>(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true`,
    counter,
  );

  const bar = data.results?.[0];
  if (!bar?.c || !Number.isFinite(bar.c) || bar.c <= 0) {
    throw new ChainError(`No closing price returned for ${symbol}.`, 200);
  }
  return { price: bar.c, asOf: bar.t ? new Date(bar.t) : new Date() };
}

/**
 * Pull the options-chain snapshot, paging until the budget is spent.
 *
 * Results are requested in ascending expiration order so the earliest
 * expirations — the ones actually displayed — stay complete even when the page
 * budget cuts the tail off.
 */
async function fetchChain(
  symbol: string,
  spot: number,
  counter: { count: number },
): Promise<{ results: SnapshotResult[]; truncated: boolean }> {
  const today = marketToday();
  const window = Math.max(30, spot * 0.06);

  const params = new URLSearchParams({
    'strike_price.gte': (spot - window).toFixed(2),
    'strike_price.lte': (spot + window).toFixed(2),
    'expiration_date.gte': today,
    'expiration_date.lte': addDays(today, POLYGON_LIMITS.expiryHorizonDays),
    limit: String(POLYGON_LIMITS.pageSize),
    sort: 'expiration_date',
    order: 'asc',
  });

  let url: string | undefined =
    `/v3/snapshot/options/${encodeURIComponent(symbol)}?${params.toString()}`;
  const results: SnapshotResult[] = [];
  let truncated = false;

  for (let page = 0; page < POLYGON_LIMITS.maxSnapshotPages && url; page += 1) {
    const data: SnapshotResponse = await polygonFetch<SnapshotResponse>(url, counter);
    if (Array.isArray(data.results)) results.push(...data.results);
    url = data.next_url;
    if (url && page === POLYGON_LIMITS.maxSnapshotPages - 1) truncated = true;
  }

  if (results.length === 0) {
    throw new ChainError(`Polygon returned no ${symbol} option contracts.`, 200);
  }

  return { results, truncated };
}

function usablePrice(raw: SnapshotResult): number | null {
  const bid = raw.last_quote?.bid;
  const ask = raw.last_quote?.ask;
  if (typeof bid === 'number' && typeof ask === 'number' && bid > 0 && ask > bid) {
    return (bid + ask) / 2;
  }
  const mid = raw.last_quote?.midpoint;
  if (typeof mid === 'number' && mid > 0) return mid;
  const close = raw.day?.close;
  if (typeof close === 'number' && close > 0) return close;
  const trade = raw.last_trade?.price;
  if (typeof trade === 'number' && trade > 0) return trade;
  return null;
}

/**
 * One complete refresh: previous close, then the chain snapshot.
 * Budget is 1 + up to 4 requests, exactly one minute of the free-plan quota.
 */
export async function fetchPolygonSnapshot(): Promise<ChainSnapshot> {
  const symbol = config.symbol;
  const counter = { count: 0 };
  const notes: string[] = [];
  const now = new Date();

  const { price: prevClose, asOf } = await fetchSpot(symbol, counter);
  const { results, truncated } = await fetchChain(symbol, prevClose, counter);

  const echoed = results.find(
    (r) => typeof r.underlying_asset?.price === 'number' && r.underlying_asset.price > 0,
  )?.underlying_asset?.price;

  const spot =
    echoed && Math.abs(echoed - prevClose) / prevClose < 0.15 ? echoed : prevClose;

  const quotes: RawQuote[] = [];
  for (const raw of results) {
    const details = raw.details;
    const strike = details?.strike_price;
    const expiration = details?.expiration_date;
    const type = details?.contract_type;
    if (!strike || !expiration || (type !== 'call' && type !== 'put')) continue;

    const openInterest = Number(raw.open_interest ?? 0);
    if (!Number.isFinite(openInterest) || openInterest <= 0) continue;

    const iv = Number(raw.implied_volatility);
    quotes.push({
      ticker: details?.ticker ?? `${expiration}-${strike}-${type}`,
      type: type as OptionType,
      strike,
      expiration,
      openInterest,
      quotedIv: Number.isFinite(iv) && iv > 0 ? iv : null,
      price: usablePrice(raw),
    });
  }

  const windowed = trimToWindow(quotes, {
    spot,
    expirationCount: config.maxExpirations,
    strikesEachSide: config.strikesEachSide,
    now,
  });

  const contracts = resolveIvSurface(windowed, {
    spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    now,
  });

  if (contracts.length === 0) {
    throw new ChainError(
      'No usable contracts after filtering.',
      200,
      'Every contract returned had zero open interest or was already expired.',
    );
  }

  if (truncated) {
    notes.push(
      'Chain was truncated at the free-plan request budget; the furthest expirations may be incomplete.',
    );
  }

  return { spot, quoteDate: asOf, contracts, requests: counter.count, notes };
}
