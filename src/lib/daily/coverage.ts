/**
 * The public ticker pages' coverage list.
 *
 * `/daily/[ticker]` is a public, indexable page and every entry here becomes a
 * URL in the sitemap, so the list is a deliberate, curated set rather than the
 * whole optionable universe. These are the most-searched, most-liquid names —
 * the ones a beginner arriving from a search for "NVDA gamma levels" is
 * actually looking for. Each has a deep listed options chain, so the Cboe
 * delayed book gives a usable floor/ceiling/flip.
 *
 * The list is small on purpose. Every symbol is one on-demand Cboe chain when
 * first requested (then cached for `GAMMADESK_CACHE_SECONDS`), and the shared
 * chain budget in `positioning.ts` is not large. Twenty-odd names a crawler can
 * walk without draining the scan's quota is the right size; a stock screener it
 * is not.
 *
 * Kept pure and free of `server-only` so `scripts/verify-coverage.mjs` can drive
 * it and the sitemap/metadata can import it from anywhere.
 */

export interface CoverageEntry {
  /** Ticker, upper case. */
  symbol: string;
  /** Company or fund name, for page titles and the "not covered" copy. */
  name: string;
  /** A one-line, plain-English description of what the name is. */
  kind: string;
}

/**
 * Ordered for display: the three index ETFs first (SPY leads because /daily
 * itself is SPY), then the mega-cap single names roughly by how often they are
 * searched. The order here is the order the links render and the sitemap lists.
 */
export const COVERAGE: readonly CoverageEntry[] = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', kind: 'the S&P 500' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', kind: 'the Nasdaq 100' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', kind: 'US small caps' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', kind: 'the chipmaker' },
  { symbol: 'AAPL', name: 'Apple Inc.', kind: 'the iPhone maker' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', kind: 'the electric-car maker' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', kind: 'the software and cloud giant' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', kind: 'the online retailer and cloud giant' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', kind: 'the owner of Facebook and Instagram' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', kind: "Google's parent company" },
  { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', kind: 'the chipmaker' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', kind: 'the chip and software maker' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', kind: 'the streaming company' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', kind: 'the largest US bank' },
  { symbol: 'COIN', name: 'Coinbase Global, Inc.', kind: 'the crypto exchange' },
  { symbol: 'PLTR', name: 'Palantir Technologies Inc.', kind: 'the data-analytics company' },
  { symbol: 'MU', name: 'Micron Technology, Inc.', kind: 'the memory-chip maker' },
  { symbol: 'INTC', name: 'Intel Corporation', kind: 'the chipmaker' },
  { symbol: 'MSTR', name: 'MicroStrategy Incorporated', kind: 'the bitcoin-holding software company' },
  { symbol: 'SMCI', name: 'Super Micro Computer, Inc.', kind: 'the AI-server maker' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', kind: 'the Dow Jones Industrial Average' },
  { symbol: 'SMH', name: 'VanEck Semiconductor ETF', kind: 'the semiconductor sector' },
] as const;

const BY_SYMBOL = new Map(COVERAGE.map((entry) => [entry.symbol, entry]));

/** Every covered ticker, in display order. */
export function coveredSymbols(): string[] {
  return COVERAGE.map((entry) => entry.symbol);
}

/** True when a ticker has its own public page. Case-insensitive. */
export function isCovered(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return BY_SYMBOL.has(symbol.toUpperCase());
}

/** The coverage entry for a ticker, or null when it is not covered. */
export function coverageEntry(symbol: string | null | undefined): CoverageEntry | null {
  if (!symbol) return null;
  return BY_SYMBOL.get(symbol.toUpperCase()) ?? null;
}
