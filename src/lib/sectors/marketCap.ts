import 'server-only';

import { config } from '../config';
import { createJsonStore } from '../jsonStore';

/**
 * Market caps for the sector weighting, from Polygon.
 *
 * `/v3/reference/tickers/{ticker}` carries `market_cap`; the bulk list
 * endpoint does not, and ignores `ticker.any_of` besides, so this is one
 * request per symbol. That is fine here: measured at sixteen concurrent
 * reference calls in half a second with no 429, so the five-a-minute ceiling
 * on the aggregates endpoints does not apply to this one.
 *
 * Caps are persisted rather than only held for the run. A night when Polygon
 * is unreachable should fall back to yesterday's figure — a cap does not move
 * enough overnight to matter — instead of collapsing the whole sector to equal
 * weight over a transient error.
 */

/** Past this, a cap is treated as missing. */
export const CAP_MAX_AGE_DAYS = 7;

export interface CapEntry {
  /** Market capitalisation in dollars. */
  cap: number;
  /** When this figure was read, ISO. */
  fetchedAt: string;
}

interface CapStore {
  caps: Record<string, CapEntry>;
}

const store = createJsonStore<CapStore>(
  'gammadesk/marketcaps.json',
  () => ({ caps: {} }),
  (raw) =>
    raw && typeof raw === 'object' && typeof (raw as CapStore).caps === 'object'
      ? (raw as CapStore)
      : null,
);

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z]{1,2})?$/;
const WAVE = 8;

async function fetchOne(symbol: string, key: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.polygon.io/v3/reference/tickers/${symbol}?apiKey=${encodeURIComponent(key)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: { market_cap?: number } };
    const cap = body.results?.market_cap;
    return typeof cap === 'number' && cap > 0 ? cap : null;
  } catch {
    return null;
  }
}

export function isFresh(entry: CapEntry | undefined, now = Date.now()): boolean {
  if (!entry || !(entry.cap > 0)) return false;
  const at = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(at)) return false;
  return (now - at) / 86_400_000 <= CAP_MAX_AGE_DAYS;
}

/**
 * Refreshes every symbol's cap and returns the merged table.
 *
 * A symbol that fails keeps whatever was stored, so `isFresh` decides later
 * whether it is still usable rather than this deciding it here.
 */
export async function refreshMarketCaps(
  symbols: string[],
): Promise<{ caps: Record<string, CapEntry>; failed: string[] }> {
  const stored = await store.read().catch(() => ({ caps: {} as Record<string, CapEntry> }));
  const caps: Record<string, CapEntry> = { ...stored.caps };
  const failed: string[] = [];

  const key = config.apiKey;
  if (!key) return { caps, failed: [...symbols] };

  const wanted = symbols.filter((s) => SYMBOL_PATTERN.test(s));
  const now = new Date().toISOString();

  for (let i = 0; i < wanted.length; i += WAVE) {
    const wave = wanted.slice(i, i + WAVE);
    const results = await Promise.all(
      wave.map(async (symbol) => ({ symbol, cap: await fetchOne(symbol, key) })),
    );
    for (const { symbol, cap } of results) {
      if (cap === null) failed.push(symbol);
      else caps[symbol] = { cap, fetchedAt: now };
    }
  }

  try {
    await store.write({ caps });
  } catch {
    // Serve what we fetched even if it could not be persisted.
  }

  return { caps, failed };
}
