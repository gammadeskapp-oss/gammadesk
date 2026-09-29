import 'server-only';

import { config } from '../config';
import type { FredObservation } from './types';

/**
 * FRED series fetcher for the Macro Bias box.
 *
 * Two upstreams, one shape out. When `FRED_API_KEY` is set the official JSON
 * API is used; otherwise the module falls back to the keyless `fredgraph.csv`
 * endpoint the net-liquidity tile already depends on. The fallback exists so
 * the feature works offline, in CI, and before anyone provisions a key — the
 * key just buys the documented, higher-rate-limit path.
 *
 * Each series is fetched on its own. `fredgraph.csv` returns a ZIP rather than
 * one table when asked for several mixed-frequency ids at once, so there is
 * nothing to gain by batching (see `lib/netLiquidity`).
 */

const JSON_API = 'https://api.stlouisfed.org/fred/series/observations';
const CSV_API = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

export class FredError extends Error {}

/** Series ids this module reads. */
export const FRED_SERIES = {
  /** Federal funds target rate, upper limit. Daily (calendar). */
  fedUpper: 'DFEDTARU',
  /** 10-year Treasury constant-maturity yield. Business-day. */
  tenYear: 'DGS10',
  /** CPI for all urban consumers, index level. Monthly. */
  cpi: 'CPIAUCSL',
} as const;

function parseRows(rows: Array<[string, string]>): FredObservation[] {
  const out: FredObservation[] = [];
  for (const [date, raw] of rows) {
    // A missing print is a literal "." in both the CSV and the JSON API.
    if (!date || !raw || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

async function fetchViaJson(
  id: string,
  apiKey: string,
  observationStart: string,
): Promise<FredObservation[]> {
  const url = new URL(JSON_API);
  url.searchParams.set('series_id', id);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('observation_start', observationStart);
  url.searchParams.set('sort_order', 'asc');

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: config.macroBias.cacheSeconds },
  });
  if (!res.ok) {
    throw new FredError(`FRED JSON API returned ${res.status} for ${id}.`);
  }

  const body = (await res.json()) as {
    observations?: Array<{ date: string; value: string }>;
  };
  const rows = (body.observations ?? []).map(
    (o) => [o.date, o.value] as [string, string],
  );
  return parseRows(rows);
}

async function fetchViaCsv(
  id: string,
  observationStart: string,
): Promise<FredObservation[]> {
  const url = new URL(CSV_API);
  url.searchParams.set('id', id);
  url.searchParams.set('cosd', observationStart);

  const res = await fetch(url, {
    headers: { Accept: 'text/csv' },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: config.macroBias.cacheSeconds },
  });
  if (!res.ok) {
    throw new FredError(`FRED CSV endpoint returned ${res.status} for ${id}.`);
  }

  const text = await res.text();
  // Header row, then `YYYY-MM-DD,value`.
  const rows = text
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(',') as [string, string]);
  return parseRows(rows);
}

/**
 * One series as `{date, value}`, oldest first.
 *
 * `observationStart` defaults to about 450 days back, which is enough for the
 * 12-month CPI look-back with margin, and cheap for the daily series.
 */
export async function fetchFredSeries(
  id: string,
  observationStart = defaultStart(),
): Promise<FredObservation[]> {
  const apiKey = config.macroBias.apiKey;
  const out = apiKey
    ? await fetchViaJson(id, apiKey, observationStart)
    : await fetchViaCsv(id, observationStart);

  if (out.length === 0) {
    throw new FredError(`FRED returned no usable rows for ${id}.`);
  }
  return out;
}

const DAY_MS = 86_400_000;

function defaultStart(): string {
  return new Date(Date.now() - 450 * DAY_MS).toISOString().slice(0, 10);
}
