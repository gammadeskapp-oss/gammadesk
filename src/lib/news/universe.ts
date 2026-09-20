/**
 * The names the scanner cares about, and how big each one is.
 *
 * The brief asks for "the top ~50 names by market cap plus anything on my
 * watchlist". Market caps are not available from a free, keyless, reliable feed
 * on every scan, and they drift slowly — a name's size *tier* changes far less
 * often than its price — so the tiering is a curated, versioned list rather
 * than a live lookup. Editing this file is the way to move a name between tiers.
 *
 * Kept free of `server-only` so the scorer (which reads `sizeTierFor`) stays
 * unit-testable. The watchlist is read from the environment at call time.
 */

/** Mega-cap leaders — the size weight is highest here. */
export const MEGA_CAP: readonly string[] = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'AVGO', 'TSLA', 'BRK.B',
  'LLY', 'JPM', 'V', 'XOM', 'UNH', 'MA', 'COST', 'HD', 'PG', 'JNJ',
  'WMT', 'NFLX', 'ABBV', 'BAC', 'ORCL', 'CRM', 'CVX', 'KO', 'AMD', 'PEP',
];

/** Large caps just below the mega tier. */
export const LARGE_CAP: readonly string[] = [
  'ADBE', 'TMO', 'MRK', 'CSCO', 'ACN', 'MCD', 'ABT', 'LIN', 'PM', 'WFC',
  'IBM', 'GE', 'DIS', 'INTC', 'QCOM', 'TXN', 'CAT', 'NOW', 'INTU', 'AMGN',
];

const MEGA = new Set(MEGA_CAP.map((s) => s.toUpperCase()));
const LARGE = new Set(LARGE_CAP.map((s) => s.toUpperCase()));

export type SizeTier = 'mega' | 'large' | 'watch' | 'other';

/** Normalise a ticker for set membership (uppercase, trim). */
export function normTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * The owner's server-side watchlist.
 *
 * The on-page watchlist lives in the visitor's browser (localStorage) and is
 * unreadable on the server, so the scanner cannot see it. `NEWS_WATCHLIST` — a
 * comma or space separated list of tickers — is the server-visible equivalent
 * the owner sets in the environment. Anything here is always scanned and always
 * scored at least at the `watch` size tier even if it is small.
 */
export function watchlist(): string[] {
  const raw = process.env.NEWS_WATCHLIST ?? '';
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => normTicker(s))
        .filter((s) => /^[A-Z][A-Z0-9]{0,6}([.-][A-Z]{1,2})?$/.test(s)),
    ),
  ];
}

/** The full set of tickers a scan pays attention to (universe ∪ watchlist). */
export function scanTickers(): Set<string> {
  const set = new Set<string>([...MEGA, ...LARGE]);
  for (const t of watchlist()) set.add(t);
  return set;
}

/**
 * Size tier for a ticker, driving the size weight in scoring. A watchlist name
 * that is not otherwise a mega/large cap still counts as `watch` (above
 * `other`) so the owner's own names are never scored as background noise.
 */
export function sizeTierFor(ticker: string | null, watch: Set<string>): SizeTier {
  if (!ticker) return 'other';
  const t = normTicker(ticker);
  if (MEGA.has(t)) return 'mega';
  if (LARGE.has(t)) return 'large';
  if (watch.has(t)) return 'watch';
  return 'other';
}
