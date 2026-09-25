import 'server-only';

/**
 * Lightweight delayed quotes for the market-pulse post, from Cboe.
 *
 * The dashboard's chain adapter (`lib/cboe.ts`) downloads the whole option book
 * to read one spot price. The pulse only needs a level and a day change for
 * four symbols, so it uses Cboe's compact quote file instead —
 * `delayed_quotes/quotes/{SYMBOL}.json`, a few hundred bytes with no options
 * array. Same CDN, same delay, same keyless access; explicitly a Cboe source,
 * never Tradier.
 *
 * Index symbols are filed under a leading underscore, the same convention the
 * chain adapter uses — VIX is `_VIX`.
 */

const CDN = 'https://cdn-api.cboe.com/api/global/delayed_quotes/quotes';

const INDEX_ROOTS = new Set(['VIX', 'SPX', 'NDX', 'RUT', 'DJX', 'OEX', 'XSP']);

function quoteUrl(symbol: string): string {
  const file = INDEX_ROOTS.has(symbol) ? `_${symbol}` : symbol;
  return `${CDN}/${encodeURIComponent(file)}.json`;
}

export interface CboeQuote {
  symbol: string;
  price: number;
  prevClose: number;
  /** Fractional day change, e.g. 0.0123 for +1.23%. */
  changePct: number;
  /** Session high, when Cboe reports one (absent pre-open). */
  dayHigh: number | null;
  /** Session low, when Cboe reports one. */
  dayLow: number | null;
  /** When Cboe stamped the payload, as a UTC ISO string. */
  quoteIso: string;
}

interface CboeQuotePayload {
  timestamp?: string;
  data?: {
    current_price?: number;
    prev_day_close?: number;
    close?: number;
    price_change_percent?: number;
    high?: number;
    low?: number;
  };
}

/** A finite, strictly-positive number from the payload, else null. */
function positive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The payload's top-level `timestamp` is `YYYY-MM-DD HH:MM:SS` in UTC with no
 * zone marker — the same quirk documented in `lib/cboe.ts`. Parsed as UTC so
 * the freshness check does not read it hours into the future.
 */
function parseTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(raw.trim());
  if (!m) return new Date().toISOString();
  return new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)),
  ).toISOString();
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Fetch one compact quote. Throws on a network or shape failure. */
export async function fetchCboeQuote(symbol: string): Promise<CboeQuote> {
  const response = await fetch(quoteUrl(symbol), {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', Referer: 'https://www.cboe.com/' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Cboe quote for ${symbol} returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as CboeQuotePayload;
  const data = payload.data;
  const price = data?.current_price ?? data?.close;
  const prevClose = data?.prev_day_close;

  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Cboe quote for ${symbol} carried no usable price.`);
  }
  if (typeof prevClose !== 'number' || !Number.isFinite(prevClose) || prevClose <= 0) {
    throw new Error(`Cboe quote for ${symbol} carried no previous close.`);
  }

  // Prefer Cboe's own change percent; fall back to computing it from the two
  // prices when the field is absent, so the pulse never invents a direction.
  const changePct =
    typeof data?.price_change_percent === 'number' && Number.isFinite(data.price_change_percent)
      ? data.price_change_percent / 100
      : price / prevClose - 1;

  return {
    symbol,
    price,
    prevClose,
    changePct,
    dayHigh: positive(data?.high),
    dayLow: positive(data?.low),
    quoteIso: parseTimestamp(payload.timestamp),
  };
}

/** Fetch several quotes in parallel, keeping only the ones that succeeded. */
export async function fetchCboeQuotes(symbols: string[]): Promise<Map<string, CboeQuote>> {
  const settled = await Promise.allSettled(symbols.map((s) => fetchCboeQuote(s)));
  const out = new Map<string, CboeQuote>();
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') out.set(symbols[i], r.value);
    else console.warn(`[x-pulse] Cboe quote for ${symbols[i]} failed:`, r.reason instanceof Error ? r.reason.message : String(r.reason));
  });
  return out;
}
