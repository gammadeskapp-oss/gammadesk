import 'server-only';

import { cached, invalidate, ttlRemaining } from './cache';
import { config } from './config';
import { buildDemoChain } from './demo';
import { buildPositioning } from './exposure';
import { fetchChainSnapshot, PolygonError } from './polygon';
import { formatAsOf } from './time';
import type { PositioningData } from './types';

const CACHE_KEY = 'positioning';

function cacheKey(): string {
  return `${CACHE_KEY}:${config.symbol}:${config.expirationCount}:${config.strikesEachSide}`;
}

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
      asOfLabel: formatAsOf(now),
      asOfIso: now.toISOString(),
      quoteDateLabel: formatAsOf(quoteDate),
      cacheSeconds: config.cacheSeconds,
      polygonRequests: 0,
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
  const snapshot = await fetchChainSnapshot();

  return buildPositioning(snapshot.contracts, {
    symbol: config.symbol,
    spot: snapshot.spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    expirationCount: config.expirationCount,
    strikesEachSide: config.strikesEachSide,
    meta: {
      source: 'polygon',
      asOfLabel: formatAsOf(now),
      asOfIso: now.toISOString(),
      quoteDateLabel: formatAsOf(snapshot.quoteDate),
      cacheSeconds: config.cacheSeconds,
      polygonRequests: snapshot.requests,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      notes: snapshot.notes,
    },
  });
}

async function produce(): Promise<PositioningData> {
  const mode = config.demoMode;

  if (mode === 'always') return sampleData([]);

  if (!config.apiKey) {
    if (mode === 'never') {
      throw new PolygonError(
        'POLYGON_API_KEY is not set.',
        0,
        'Add it to .env.local locally, and to Project Settings -> Environment Variables on Vercel.',
      );
    }
    return sampleData([
      'POLYGON_API_KEY is not set, so no live data could be fetched.',
    ]);
  }

  try {
    return await liveData();
  } catch (error) {
    if (mode === 'never') throw error;

    const reason =
      error instanceof PolygonError
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
 * (30 minutes by default), and concurrent callers share one in-flight fetch,
 * so a burst of traffic still costs at most one refresh.
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
