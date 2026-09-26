import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { ForecastResult } from './types';

/**
 * Cross-instance cache of the configured symbol's forecast — the other heavy
 * half of a cold /decision render. `getForecast` memoises in-process, but a cold
 * lambda starts empty and pays the full chain fetch + Monte Carlo simulation.
 * The refresher cron writes this Blob every few minutes; a cold instance reads
 * it in well under a second. Only the configured symbol is cached (the one the
 * cron can pre-compute); an on-demand ticker still simulates on request.
 */
interface CachedForecast {
  data: ForecastResult;
  builtAtIso: string;
}

const store = createJsonStore<CachedForecast | null>(
  'gammadesk/forecast-spy.json',
  () => null,
  (raw) => {
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as CachedForecast).builtAtIso === 'string' &&
      (raw as CachedForecast).data &&
      typeof (raw as CachedForecast).data === 'object'
    ) {
      return raw as CachedForecast;
    }
    return null;
  },
);

/** Persist the freshly simulated forecast. Best-effort. */
export async function writeCachedForecast(data: ForecastResult): Promise<void> {
  await store.write({ data, builtAtIso: new Date().toISOString() }).catch(() => {});
}

/** The cached forecast if written within `maxAgeSeconds`, else null. */
export async function readFreshCachedForecast(
  maxAgeSeconds: number,
  now: Date = new Date(),
): Promise<ForecastResult | null> {
  const cached = await store.read().catch(() => null);
  if (!cached) return null;
  const builtMs = Date.parse(cached.builtAtIso);
  if (!Number.isFinite(builtMs)) return null;
  if ((now.getTime() - builtMs) / 1000 > maxAgeSeconds) return null;
  return cached.data;
}
