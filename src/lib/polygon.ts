import 'server-only';

import { config, POLYGON_LIMITS } from './config';
import { polygonLimiter } from './rateLimit';
import { impliedVol, MIN_T } from './blackScholes';
import { addDays, marketToday, yearsToExpiry } from './time';
import { modelIv } from './volSurface';
import type { IvSource, NormalisedContract, OptionType } from './types';

const BASE = 'https://api.polygon.io';

export class PolygonError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'PolygonError';
  }
}

interface PrevCloseResponse {
  status?: string;
  results?: Array<{ c?: number; t?: number }>;
}

interface SnapshotResult {
  details?: {
    contract_type?: string;
    expiration_date?: string;
    strike_price?: number;
    ticker?: string;
    shares_per_contract?: number;
  };
  greeks?: { gamma?: number; delta?: number; vega?: number; theta?: number };
  implied_volatility?: number;
  open_interest?: number;
  day?: { close?: number; last_updated?: number };
  last_quote?: { bid?: number; ask?: number; midpoint?: number };
  last_trade?: { price?: number };
  underlying_asset?: { price?: number; ticker?: string };
}

interface SnapshotResponse {
  status?: string;
  results?: SnapshotResult[];
  next_url?: string;
  error?: string;
  message?: string;
}

/**
 * Every outbound Polygon call funnels through here so the rate limiter, the
 * request counter and the error translation all stay in one place.
 *
 * `next: { revalidate }` puts the response into the Next.js Data Cache, which
 * on Vercel is shared across lambda instances — that, not the in-process
 * limiter, is what actually keeps a busy deployment inside the free quota.
 */
async function polygonFetch<T>(
  url: string,
  counter: { count: number },
): Promise<T> {
  const key = config.apiKey;
  if (!key) {
    throw new PolygonError(
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
    throw new PolygonError(
      'Could not reach the Polygon API.',
      0,
      cause instanceof Error ? cause.message : undefined,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new PolygonError(
      `Polygon rejected the request (HTTP ${response.status}).`,
      response.status,
      'The key may be wrong, or your plan may not include the options snapshot endpoint.',
    );
  }
  if (response.status === 429) {
    throw new PolygonError(
      'Polygon rate limit hit (HTTP 429).',
      429,
      'The free plan allows 5 requests per minute. Wait a minute and refresh.',
    );
  }
  if (!response.ok) {
    throw new PolygonError(
      `Polygon returned HTTP ${response.status}.`,
      response.status,
    );
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
  const price = bar?.c;
  if (!price || !Number.isFinite(price) || price <= 0) {
    throw new PolygonError(
      `No closing price returned for ${symbol}.`,
      200,
      'Polygon returned an empty result set — this usually means the free plan has no data for this ticker.',
    );
  }

  return { price, asOf: bar?.t ? new Date(bar.t) : new Date() };
}

/**
 * Pull the options-chain snapshot, paging until the budget is spent.
 *
 * Results are requested in ascending expiration order, so the earliest
 * expirations — the ones we actually display — are complete even when the page
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
    throw new PolygonError(
      `Polygon returned no ${symbol} option contracts.`,
      200,
      'The options snapshot endpoint may not be included in your plan.',
    );
  }

  return { results, truncated };
}

/** Best available traded price for a contract, used to back out implied vol. */
function observedPrice(raw: SnapshotResult): number | null {
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
 * Turn a raw snapshot row into the shape the exposure engine wants, resolving
 * implied vol from the API, then from an observed price, then from the model.
 */
function normalise(
  raw: SnapshotResult,
  spot: number,
  now: Date,
): NormalisedContract | null {
  const details = raw.details;
  const strike = details?.strike_price;
  const expiration = details?.expiration_date;
  const rawType = details?.contract_type;

  if (!strike || !expiration || (rawType !== 'call' && rawType !== 'put')) {
    return null;
  }

  const T = yearsToExpiry(expiration, now);
  if (T <= 0) return null; // already expired

  const openInterest = Number(raw.open_interest ?? 0);
  if (!Number.isFinite(openInterest) || openInterest <= 0) return null;

  const type = rawType as OptionType;

  let iv = Number(raw.implied_volatility);
  let ivSource: IvSource = 'api';

  if (!Number.isFinite(iv) || iv <= 0.001 || iv > 5) {
    const price = observedPrice(raw);
    const solved =
      price === null
        ? null
        : impliedVol(
            price,
            {
              S: spot,
              K: strike,
              T: Math.max(T, MIN_T),
              r: config.riskFreeRate,
              q: config.dividendYield,
            },
            type,
          );

    if (solved !== null) {
      iv = solved;
      ivSource = 'solved';
    } else {
      iv = modelIv(spot, strike, T);
      ivSource = 'model';
    }
  }

  return {
    ticker: details?.ticker ?? `${expiration}-${strike}-${type}`,
    type,
    strike,
    expiration,
    openInterest,
    iv,
    ivSource,
    T: Math.max(T, MIN_T),
  };
}

export interface ChainSnapshot {
  spot: number;
  quoteDate: Date;
  contracts: NormalisedContract[];
  requests: number;
  notes: string[];
}

/**
 * One complete refresh: previous close, then the chain snapshot.
 * Budget is 1 + up to 4 requests = at most 5, exactly the free-plan minute.
 */
export async function fetchChainSnapshot(): Promise<ChainSnapshot> {
  const symbol = config.symbol;
  const counter = { count: 0 };
  const notes: string[] = [];
  const now = new Date();

  const { price: prevClose, asOf } = await fetchSpot(symbol, counter);
  const { results, truncated } = await fetchChain(symbol, prevClose, counter);

  // The snapshot echoes the underlying's price; prefer it when it looks sane.
  const echoed = results.find(
    (r) => typeof r.underlying_asset?.price === 'number' && r.underlying_asset.price > 0,
  )?.underlying_asset?.price;

  const spot =
    echoed && Math.abs(echoed - prevClose) / prevClose < 0.15 ? echoed : prevClose;

  const contracts = results
    .map((raw) => normalise(raw, spot, now))
    .filter((c): c is NormalisedContract => c !== null);

  if (contracts.length === 0) {
    throw new PolygonError(
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
