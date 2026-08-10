import 'server-only';

import { cached, invalidate, ttlRemaining } from './cache';
import type { ChainSnapshot } from './chainSource';
import { ChainError } from './chainSource';
import { config } from './config';
import { fetchCboeSnapshot } from './cboe';
import { buildDemoChain } from './demo';
import { buildPositioning } from './exposure';
import { fetchPolygonSnapshot } from './polygon';
import { formatAsOf } from './time';
import type { DataSource, PositioningData } from './types';

const SOURCE_LABELS: Record<DataSource, string> = {
  cboe: 'Cboe (delayed)',
  polygon: 'Polygon.io',
  sample: 'generated sample',
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
  const mode = config.demoMode;

  const sample = (notes: string[]): RawSnapshot => {
    const { spot, quoteDate, contracts } = buildDemoChain(
      config.strikesEachSide,
      config.maxExpirations,
    );
    return {
      snapshot: { spot, quoteDate, contracts, requests: 0, notes: [] },
      source: 'sample',
      notes: [
        'Showing generated sample data, not market data. Do not trade off these numbers.',
        ...notes,
      ],
    };
  };

  if (mode === 'always') return sample([]);

  if (config.dataSource === 'polygon' && !config.apiKey) {
    if (mode === 'never') {
      throw new ChainError(
        'POLYGON_API_KEY is not set.',
        0,
        'Add it to .env.local locally, and to Project Settings -> Environment Variables on Vercel.',
      );
    }
    return sample(['POLYGON_API_KEY is not set, so no live data could be fetched.']);
  }

  try {
    const source = config.dataSource;
    const snapshot =
      source === 'polygon' ? await fetchPolygonSnapshot() : await fetchCboeSnapshot();
    return { snapshot, source, notes: snapshot.notes };
  } catch (error) {
    if (mode === 'never') throw error;

    const reason =
      error instanceof ChainError
        ? [error.message, error.hint].filter(Boolean).join(' ')
        : error instanceof Error
          ? error.message
          : 'Unknown error.';

    return sample([`Live data unavailable — ${reason}`]);
  }
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
      const snapshot = await fetchCboeSnapshot(symbol);
      return toPositioning(
        { snapshot, source: 'cboe', notes: snapshot.notes },
        expirationCount,
        symbol,
      );
    },
  );
}

/** Seconds until the cached snapshot goes stale — shown next to "data as of". */
export function secondsUntilRefresh(): number {
  return Math.ceil(ttlRemaining(viewCacheKey(config.expirationCount)) / 1000);
}
