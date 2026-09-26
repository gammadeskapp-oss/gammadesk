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

/** The raw cached forecast with the time it was built, or null when never written. */
export async function readCachedForecast(): Promise<{ data: ForecastResult; builtAtIso: string } | null> {
  return store.read().catch(() => null);
}
