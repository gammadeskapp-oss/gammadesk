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
 * That note describes the FREE plan and it still holds. On a paid options plan
 * — Options Starter and up — `/v3/snapshot/options/{underlying}` is included,
 * with open interest and implied volatility on every contract, unlimited API
 * calls, and a fifteen-minute delay.
 *
 * The delay is irrelevant to everything this app computes from a chain. Gamma
 * exposure is built from open interest, and open interest publishes once a day
 * after the close, so a quote fifteen minutes old carries exactly the same
 * exposure as a live one.
 *
 * Two entry points, and the difference matters:
 *
 *  - `fetchPolygonSnapshot()` is the dashboard's single-symbol refresh. It
 *    reads `config.symbol` and is selected with `GAMMADESK_DATA_SOURCE=polygon`.
 *  - `fetchPolygonChain(symbol)` is the scanner's, and it is what makes
 *    scoring the whole index affordable: unlimited calls means the gamma job
 *    is no longer rationed to the couple of dozen names a free Cboe window
 *    allows. See `scanner/gammaSource.ts`.
 *
 * `probePolygonOptions()` answers, at runtime and out loud, whether the key in
 * use is actually entitled to any of this.
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
  greeks?: { gamma?: number; delta?: number };
  day?: { close?: number; volume?: number };
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
/**
 * Whether a path is an options-plan endpoint.
 *
 * The distinction is a billing one and it is load-bearing. An Options Starter
 * plan makes `/v3/snapshot/options/...` unlimited; it does not touch the
 * **stocks** entitlement, so `/v2/aggs/...` is still whatever the stocks plan
 * allows — five requests a minute on the free tier. Throttling both the same
 * way either cripples the options path or floods the stocks one, and flooding
 * the stocks one is what limited a whole-universe gamma refresh to five
 * symbols before everything else fell back to Cboe.
 */
function isOptionsEndpoint(url: string): boolean {
  return url.startsWith('/v3/snapshot/options/') || url.startsWith('/v3/reference/options/');
}

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

  /*
   * Options calls use the options plan's cap — zero meaning "unlimited, do not
   * throttle". Everything else is a stocks call and keeps the free plan's five
   * a minute, because that entitlement did not change.
   */
  const rpm = isOptionsEndpoint(url)
    ? config.polygonOptions.rpm
    : POLYGON_LIMITS.requestsPerMinute;
  if (rpm > 0) await polygonLimiter(rpm).acquire();
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
  pageLimit?: number,
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

  /*
   * The page budget is a plan entitlement, not a tuning knob: on the free plan
   * four pages was one whole minute of quota, and on a paid plan there is no
   * per-minute quota to spend. See `config.polygonOptions.maxPages`.
   */
  /*
   * A caller sweeping hundreds of symbols passes its own, much smaller, page
   * limit. Latency is the binding constraint there rather than quota: each
   * page is a round trip, results come back in ascending expiration order, and
   * `trimToWindow` discards everything past the displayed expirations anyway —
   * so pages beyond the first few are paid for and then thrown away. Measured
   * on the whole index at twelve pages: 132 chains in 241 seconds. See
   * `config.scanner.polygonPagesPerChain`.
   */
  const maxPages =
    pageLimit ?? Math.max(POLYGON_LIMITS.maxSnapshotPages, config.polygonOptions.maxPages);

  for (let page = 0; page < maxPages && url; page += 1) {
    const data: SnapshotResponse = await polygonFetch<SnapshotResponse>(url, counter);
    if (Array.isArray(data.results)) results.push(...data.results);
    url = data.next_url;
    if (url && page === maxPages - 1) truncated = true;
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
  return fetchPolygonChain(config.symbol);
}

/**
 * One named symbol's chain, as a `ChainSnapshot`.
 *
 * ## Why the scanner uses this rather than Cboe
 *
 * Cboe's free feed answers roughly sixty chain requests per window and then
 * refuses — a quota, not a rate. That single number decided the shape of the
 * whole scanner: gamma could only be refreshed for the few dozen names that
 * had already cleared a relative-strength floor, so seven scored components
 * were available for those names and five for the other four hundred and
 * fifty. A paid Polygon options plan has no such quota, so the same job can
 * cover the index and the gamma component stops being a privilege of the top
 * of the list.
 *
 * ## Gamma is computed here, not read from the provider
 *
 * Polygon returns greeks on the snapshot at some tiers, and this deliberately
 * ignores them. Every other surface in this app derives gamma from open
 * interest, strike and IV through `blackScholes.ts` under one stated set of
 * assumptions — rate, dividend, and the dealer-sign convention — and mixing a
 * provider's greeks into one page would make that page disagree with the rest
 * of the site about the same chain on the same day. Open interest and IV are
 * what this needs, and both are on the snapshot.
 */
export async function fetchPolygonChain(
  symbol: string,
  options: { spot?: number; maxPages?: number } = {},
): Promise<ChainSnapshot> {
  const counter = { count: 0 };
  const notes: string[] = [];
  const now = new Date();

  /*
   * ## The spot price comes from the options snapshot, not from /v2/aggs
   *
   * This is the difference between a gamma refresh that covers five hundred
   * names and one that covers five. The previous-close endpoint is a *stocks*
   * call, and an options plan does not buy stocks entitlement — so on a
   * five-a-minute stocks tier, a five-hundred-symbol run spent its first five
   * requests and then took 429 on every remaining symbol, falling back to
   * Cboe until that quota went too. Measured: 5 chains from Polygon, 67 from
   * Cboe, 432 outright failures.
   *
   * Every options snapshot result echoes `underlying_asset.price`, so one
   * cheap unlimited options request establishes spot and the stocks endpoint
   * is never touched. It is kept as the fallback for the case where the
   * snapshot does not echo a usable price.
   */
  const { price: prevClose, asOf, source: spotSource } = await fetchChainSpot(
    symbol,
    counter,
    options.spot,
  );
  if (spotSource === 'aggs') {
    notes.push(
      'The underlying price came from the previous-close endpoint. That is a stocks-plan request, rate limited separately from the options plan — a caller refreshing many symbols should pass a price it already holds.',
    );
  }
  const { results, truncated } = await fetchChain(
    symbol,
    prevClose,
    counter,
    options.maxPages,
  );

  const echoed = results.find(
    (r) => typeof r.underlying_asset?.price === 'number' && r.underlying_asset.price > 0,
  )?.underlying_asset?.price;

  const spot =
    echoed && Math.abs(echoed - prevClose) / prevClose < 0.15 ? echoed : prevClose;

  /*
   * Whole-chain totals, summed across everything returned and before any
   * trimming — the same quantity `cboe.ts` reports, so the tradeability tiers
   * mean the same thing whichever adapter served the row.
   *
   * It is a floor rather than an exact total when `truncated` is set, and the
   * note below says so. A number that is complete on most names and quietly
   * partial on the widest chains is worse than one that states its own
   * limitation.
   */
  let chainVolume = 0;
  let chainOpenInterest = 0;
  for (const raw of results) {
    const volume = Number(raw.day?.volume ?? 0);
    const oi = Number(raw.open_interest ?? 0);
    if (Number.isFinite(volume) && volume > 0) chainVolume += volume;
    if (Number.isFinite(oi) && oi > 0) chainOpenInterest += oi;
  }

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

  return {
    spot,
    quoteDate: asOf,
    contracts,
    requests: counter.count,
    activity: { volume: chainVolume, openInterest: chainOpenInterest },
    notes,
  };
}

/**
 * Spot for a symbol, in order of what it costs.
 *
 * ## A caller-supplied price is not a shortcut; it is the whole fix
 *
 * The measurement that produced this ordering: an options plan does not buy
 * stocks entitlement, so `/v2/aggs/.../prev` is still five requests a minute.
 * A five-hundred-symbol gamma refresh therefore spent its first five requests
 * and then queued sixty seconds per symbol behind the limiter — SPY and NVDA
 * took 61 and 59 seconds each, against 0.4 seconds for the symbols that did
 * not have to wait.
 *
 * The scanner already holds a previous close for every name in the
 * relative-strength digest — the same quantity the stocks endpoint returns,
 * fetched once for the whole index and stored. So it passes that in, and the
 * throttled call is never made.
 *
 * The snapshot's own `underlying_asset.price` is tried next. It is documented
 * and it is genuinely absent on this plan (the object carries a ticker and
 * nothing else), which is exactly why the caller-supplied price matters — but
 * it is cheap to check and costs one unlimited options request on the tiers
 * that do serve it.
 */
async function fetchChainSpot(
  symbol: string,
  counter: { count: number },
  hint?: number,
): Promise<{ price: number; asOf: Date; source: 'caller' | 'snapshot' | 'aggs' }> {
  if (typeof hint === 'number' && Number.isFinite(hint) && hint > 0) {
    return { price: hint, asOf: new Date(), source: 'caller' };
  }

  try {
    const data = await polygonFetch<SnapshotResponse>(
      `/v3/snapshot/options/${encodeURIComponent(symbol)}?limit=1`,
      counter,
    );
    const price = data.results?.find(
      (r) => typeof r.underlying_asset?.price === 'number' && r.underlying_asset.price > 0,
    )?.underlying_asset?.price;

    if (typeof price === 'number' && price > 0) {
      return { price, asOf: new Date(), source: 'snapshot' };
    }
  } catch {
    // Fall through to the stocks endpoint, which is reported by the caller.
  }

  const { price, asOf } = await fetchSpot(symbol, counter);
  return { price, asOf, source: 'aggs' };
}

// --- entitlement -------------------------------------------------------------

export interface PolygonOptionsProbe {
  /** Whether the snapshot endpoint answered at all on this key. */
  available: boolean;
  /** HTTP status behind the answer, for the log line. */
  status: number;
  /** Whether the contracts carried the fields gamma exposure is built from. */
  hasOpenInterest: boolean;
  hasImpliedVolatility: boolean;
  /** Reported for completeness; nothing here reads provider greeks. */
  hasGreeks: boolean;
  /** One sentence saying what was found, always populated. */
  detail: string;
}

/**
 * Ask the key what it is entitled to, in one cheap request.
 *
 * ## Why this is a probe and not a config flag
 *
 * A flag says what someone believed when they set it. This says what the API
 * answered a moment ago, which is the only thing that decides whether the run
 * will work — plans change, keys get rotated into a lower tier, and the
 * failure mode of guessing is a scan that silently produces a page with no
 * dealer positioning on any row.
 *
 * The result is logged whether it succeeds or fails, and the caller reports
 * which source actually served the run. Nothing here fails over quietly.
 */
export async function probePolygonOptions(
  symbol = config.symbol,
): Promise<PolygonOptionsProbe> {
  const counter = { count: 0 };

  try {
    const data = await polygonFetch<SnapshotResponse>(
      `/v3/snapshot/options/${encodeURIComponent(symbol)}?limit=1`,
      counter,
    );
    const first = data.results?.[0];

    if (!first) {
      return {
        available: true,
        status: 200,
        hasOpenInterest: false,
        hasImpliedVolatility: false,
        hasGreeks: false,
        detail: `The options snapshot answered for ${symbol} but returned no contracts, so the fields it carries could not be established.`,
      };
    }

    const hasOpenInterest = typeof first.open_interest === 'number';
    const hasImpliedVolatility = typeof first.implied_volatility === 'number';
    const hasGreeks = typeof first.greeks?.gamma === 'number';

    return {
      available: true,
      status: 200,
      hasOpenInterest,
      hasImpliedVolatility,
      hasGreeks,
      detail:
        `The options snapshot is available on this key. Open interest ${hasOpenInterest ? 'present' : 'ABSENT'}, ` +
        `implied volatility ${hasImpliedVolatility ? 'present' : 'ABSENT'}, provider greeks ${hasGreeks ? 'present' : 'absent'} ` +
        `(unused — exposure is computed from open interest, strike and IV here).`,
    };
  } catch (error) {
    const status = error instanceof ChainError ? error.status : 0;
    return {
      available: false,
      status,
      hasOpenInterest: false,
      hasImpliedVolatility: false,
      hasGreeks: false,
      detail: `The options snapshot is not usable on this key (${error instanceof Error ? error.message : String(error)}). The scanner falls back to Cboe, which is rationed to roughly sixty chains per window.`,
    };
  }
}
