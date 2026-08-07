import 'server-only';

import { cached, invalidate, ttlRemaining } from './cache';
import { ChainError } from './chainSource';
import { config } from './config';
import { fetchCboeSnapshot } from './cboe';
import { buildDemoChain } from './demo';
import { buildPositioning } from './exposure';
import { fetchPolygonSnapshot } from './polygon';
import { formatAsOf } from './time';
import type { DataSource, PositioningData } from './types';

const CACHE_KEY = 'positioning';

function cacheKey(): string {
  return [
    CACHE_KEY,
    config.dataSource,
    config.symbol,
    config.expirationCount,
    config.strikesEachSide,
  ].join(':');
}

const SOURCE_LABELS: Record<DataSource, string> = {
  cboe: 'Cboe (delayed)',
  polygon: 'Polygon.io',
  sample: 'generated sample',
};

function sampleData(notes: string[]): PositioningData {
  const now = new Date();
  const { spot, quoteDate, contracts } = buildDemoChain(
    config.strikesEachSide,
    config.expirationCount,
  );

  return buildPositioning(contracts, {
    symbol: config.symbol,
    spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    expirationCount: config.expirationCount,
    strikesEachSide: config.strikesEachSide,
    meta: {
      source: 'sample',
      sourceLabel: SOURCE_LABELS.sample,
      asOfLabel: formatAsOf(now),
      asOfIso: now.toISOString(),
      quoteDateLabel: formatAsOf(quoteDate),
      quoteDateIso: quoteDate.toISOString(),
      cacheSeconds: config.cacheSeconds,
      upstreamRequests: 0,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      notes: [
        'Showing generated sample data, not market data. Do not trade off these numbers.',
        ...notes,
      ],
    },
  });
}

async function liveData(): Promise<PositioningData> {
  const now = new Date();
  const source = config.dataSource;
  const snapshot =
    source === 'polygon' ? await fetchPolygonSnapshot() : await fetchCboeSnapshot();

  return buildPositioning(snapshot.contracts, {
    symbol: config.symbol,
    spot: snapshot.spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    expirationCount: config.expirationCount,
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
      notes: snapshot.notes,
    },
  });
}

async function produce(): Promise<PositioningData> {
  const mode = config.demoMode;

  if (mode === 'always') return sampleData([]);

  // Only the Polygon adapter needs a key; Cboe is keyless.
  if (config.dataSource === 'polygon' && !config.apiKey) {
    if (mode === 'never') {
      throw new ChainError(
        'POLYGON_API_KEY is not set.',
        0,
        'Add it to .env.local locally, and to Project Settings -> Environment Variables on Vercel.',
      );
    }
    return sampleData(['POLYGON_API_KEY is not set, so no live data could be fetched.']);
  }

  try {
    return await liveData();
  } catch (error) {
    if (mode === 'never') throw error;

    const reason =
      error instanceof ChainError
        ? [error.message, error.hint].filter(Boolean).join(' ')
        : error instanceof Error
          ? error.message
          : 'Unknown error.';

    return sampleData([`Live data unavailable — ${reason}`]);
  }
}

/**
 * The dashboard's single data entry point.
 *
 * Every caller shares one cached result for `GAMMADESK_CACHE_SECONDS`
 * (5 minutes on Cboe, 30 on Polygon), and concurrent callers share one
 * in-flight fetch, so a burst of traffic still costs at most one refresh.
 */
export async function getPositioning(
  options: { force?: boolean } = {},
): Promise<PositioningData> {
  const key = cacheKey();
  if (options.force) invalidate(key);
  return cached(key, config.cacheSeconds, produce);
}

/** Seconds until the cached snapshot goes stale — shown next to "data as of". */
export function secondsUntilRefresh(): number {
  return Math.ceil(ttlRemaining(cacheKey()) / 1000);
}
