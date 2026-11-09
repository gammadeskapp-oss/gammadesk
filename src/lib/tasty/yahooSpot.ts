import 'server-only';

/**
 * A near-real-time spot for `/lab` while the Tastytrade stream is delayed.
 *
 * Tastytrade only streams real time when the account has real-time quotes
 * enabled; until then (`has-delayed-quotes`, token level `demo`) every price is
 * 15 minutes old. Yahoo's chart endpoint carries the regular-session price
 * within about a second (measured 2026-11-09 09:55 ET: 1 s behind the clock,
 * while Cboe's delayed quote was ~18 min and Tastytrade's 15 min behind).
 *
 * Only the underlying price comes from here. Option IV and open interest still
 * come from the Tastytrade feed, so the page labels the two sources apart.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export interface YahooSpot {
  price: number;
  /** Epoch ms of Yahoo's `regularMarketTime`. */
  timeMs: number;
}

interface YahooMeta {
  chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }> };
}

/** Null on any failure — the caller keeps the feed's own (delayed) spot. */
export async function fetchYahooSpot(symbol: string): Promise<YahooSpot | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=false`,
      {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(4_000),
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    const meta = ((await res.json()) as YahooMeta).chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const time = meta?.regularMarketTime;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
    if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null;
    return { price, timeMs: time * 1000 };
  } catch {
    return null;
  }
}
