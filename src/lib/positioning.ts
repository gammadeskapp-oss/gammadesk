import 'server-only';

import { cached, invalidate, ttlRemaining } from './cache';
import type { ChainSnapshot } from './chainSource';
import { ChainError } from './chainSource';
import { config } from './config';
import { fetchCboeSnapshot } from './cboe';
import { buildPositioning } from './exposure';
import { fetchPolygonSnapshot } from './polygon';
import { formatAsOf } from './time';
import type { DataSource, PositioningData } from './types';

const SOURCE_LABELS: Record<DataSource, string> = {
  cboe: 'Cboe (delayed)',
  polygon: 'Polygon.io',
};

/** What one refresh produces, before it is narrowed to a display window. */
interface RawSnapshot {
  snapshot: ChainSnapshot;
  source: DataSource;
  notes: string[];
}

function snapshotCacheKey(): string {
  return `chain:${config.dataSource}:${config.symbol}:${config.maxExpirations}:${config.strikesEachSide}`;
}

function viewCacheKey(expirationCount: number): string {
  return `positioning:${config.dataSource}:${config.symbol}:${expirationCount}:${config.strikesEachSide}`;
}

/**
 * One upstream refresh, shared by every view.
 *
 * The dashboard wants five expirations and the forecast wants twenty. Both are
 * built from this single cached snapshot, so widening the forecast horizon
 * costs nothing upstream.
 */
async function loadSnapshot(): Promise<RawSnapshot> {
  if (config.dataSource === 'polygon' && !config.apiKey) {
    throw new ChainError(
      'POLYGON_API_KEY is not set.',
      0,
      'Add it to .env.local locally, and to Project Settings -> Environment Variables on Vercel.',
    );
  }

  const source = config.dataSource;
  const snapshot =
    source === 'polygon' ? await fetchPolygonSnapshot() : await fetchCboeSnapshot();
  return { snapshot, source, notes: snapshot.notes };
}

function cachedSnapshot(): Promise<RawSnapshot> {
  return cached(snapshotCacheKey(), config.cacheSeconds, loadSnapshot);
}

function toPositioning(
  raw: RawSnapshot,
  expirationCount: number,
  symbol = config.symbol,
): PositioningData {
  const now = new Date();
  const { snapshot, source, notes } = raw;

  return buildPositioning(snapshot.contracts, {
    symbol,
    spot: snapshot.spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    expirationCount,
    strikesEachSide: config.strikesEachSide,
    meta: {
      source,
      sourceLabel: SOURCE_LABELS[source],
      asOfLabel: formatAsOf(now),
      asOfIso: now.toISOString(),
      quoteDateLabel: formatAsOf(snapshot.quoteDate),
      quoteDateIso: snapshot.quoteDate.toISOString(),
      cacheSeconds: config.cacheSeconds,
      upstreamRequests: snapshot.requests,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      notes,
    },
  });
}

/**
 * The dashboard's data entry point.
 *
 * Every caller shares one cached result for `GAMMADESK_CACHE_SECONDS`
 * (5 minutes on Cboe, 30 on Polygon), and concurrent callers share one
 * in-flight fetch, so a burst of traffic still costs at most one refresh.
 */
export async function getPositioning(
  options: { force?: boolean } = {},
): Promise<PositioningData> {
  if (options.force) {
    invalidate(snapshotCacheKey());
    invalidate(viewCacheKey(config.expirationCount));
  }
  return cached(viewCacheKey(config.expirationCount), config.cacheSeconds, async () =>
    toPositioning(await cachedSnapshot(), config.expirationCount),
  );
}

/**
 * The same book, widened to enough expirations to cover the forecast horizon.
 * Reuses the cached snapshot, so this costs no extra upstream request.
 */
export async function getForecastPositioning(): Promise<PositioningData> {
  const count = config.forecastExpirations;
  return cached(viewCacheKey(count), config.cacheSeconds, async () =>
    toPositioning(await cachedSnapshot(), count),
  );
}

/**
 * Fresh single-symbol chain fetches allowed per minute, process-wide.
 *
 * Cboe answers roughly sixty chain requests per window before it starts
 * returning 429 (see `SCAN_MAX_REQUESTS`), and the flow scan already spends
 * most of one window when it runs. Letting an on-demand ticker box issue an
 * unbounded number of fetches would mean anyone walking the alphabet through
 * `?symbol=` could drain that quota and take the scan down with them.
 *
 * A third of the window is a generous slice for readers — a cache hit costs
 * nothing and never touches this — while leaving the scheduled scan room to
 * finish. The cap refuses rather than queues: a page that eventually renders
 * three minutes late is worse than one that says it is busy.
 */
const ON_DEMAND_CHAINS_PER_MINUTE = 20;
const ON_DEMAND_WINDOW_MS = 60_000;

const budgetKey = Symbol.for('gammadesk.positioning.onDemandBudget');
type GlobalWithBudget = typeof globalThis & { [budgetKey]?: number[] };

/**
 * Per-process, so a fleet of lambdas each get their own allowance. That is the
 * same caveat `rateLimit.ts` carries and for the same reason: the durable
 * protection is the TTL cache in front of this, and the budget is the backstop
 * for the case the cache cannot help with — a flood of *distinct* symbols.
 */
function claimChainBudget(): boolean {
  const g = globalThis as GlobalWithBudget;
  const hits = (g[budgetKey] ??= []);

  const now = Date.now();
  while (hits.length > 0 && now - hits[0] >= ON_DEMAND_WINDOW_MS) hits.shift();

  if (hits.length >= ON_DEMAND_CHAINS_PER_MINUTE) return false;
  hits.push(now);
  return true;
}

/**
 * Positioning for an arbitrary symbol, for the forecast's ticker mode.
 *
 * Separate from the cached SPY path on purpose: that one shares a single chain
 * snapshot between the dashboard and the forecast, which only makes sense for
 * the configured symbol. This fetches one chain for one symbol and caches it
 * under its own key.
 *
 * Throws when the symbol has no usable listed chain — callers decide whether
 * that is fatal or simply means "no magnets".
 */
export async function getPositioningForSymbol(
  symbol: string,
  expirationCount = config.forecastExpirations,
): Promise<PositioningData> {
  return cached(
    `positioning-symbol:${symbol}:${expirationCount}:${config.strikesEachSide}`,
    config.cacheSeconds,
    async () => {
      // Inside the producer, so only a genuine miss spends budget — a cached
      // symbol is free however often it is asked for.
      if (!claimChainBudget()) {
        throw new ChainError(
          'Too many different tickers were requested in the last minute.',
          429,
          'Cboe caps how many chains can be pulled per window, and the allowance is shared. Wait a moment and try again — tickers already loaded are still instant.',
        );
      }
      const snapshot = await fetchCboeSnapshot(symbol);
      return toPositioning(
        { snapshot, source: 'cboe', notes: snapshot.notes },
        expirationCount,
        symbol,
      );
    },
  );
}

/**
 * A ticker as it may be typed into the positioning box, or null when it could
 * not be one.
 *
 * Deliberately strict, and applied before the symbol reaches a URL: the value
 * goes straight into a CDN path and into a cache key, and neither should be
 * reachable by anything a visitor can type. One to five letters covers every
 * plain US listing the symbol directory keeps (see `symbols/directory.ts`,
 * which filters on the same rule).
 */
export function normaliseSymbol(raw: string | undefined): string | null {
  const symbol = (raw ?? '').trim().toUpperCase();
  return /^[A-Z]{1,5}$/.test(symbol) ? symbol : null;
}

/**
 * The positioning page's data entry point, for whichever symbol was asked for.
 *
 * The configured symbol keeps its existing path, so the dashboard and the
 * forecast still share one chain snapshot between them; anything else gets its
 * own fetch and its own cache entry, on demand.
 *
 * On demand is the whole design. Cboe answers roughly sixty chain requests per
 * window (`SCAN_MAX_REQUESTS` in `scanUniverse.ts`), which the flow scan
 * already spends most of, so preloading a stock universe here is not available
 * even in principle. One chain per symbol somebody actually asked for, cached
 * for `GAMMADESK_CACHE_SECONDS`, is what fits — and it means the cost scales
 * with readers rather than with the size of the market.
 */
export async function getPositioningView(symbol: string): Promise<PositioningData> {
  if (symbol === config.symbol) return getPositioning();
  return getPositioningForSymbol(symbol, config.expirationCount);
}

/** Seconds until the cached snapshot goes stale — shown next to "data as of". */
export function secondsUntilRefresh(): number {
  return Math.ceil(ttlRemaining(viewCacheKey(config.expirationCount)) / 1000);
}
