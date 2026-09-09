import 'server-only';

import { getSymbolDirectory } from '../symbols/directory';

/**
 * The scan universe: US common stocks, not just the S&P 500.
 *
 * The spec wants the whole listed common-stock universe — most of it small and
 * mid caps — rather than the index the rest of the site ranks. The symbol
 * directory that already backs ticker autocomplete is exactly that list: every
 * listed US name from the Nasdaq Trader feeds, warrants/units/preferreds
 * already stripped by its plain-ticker filter, ETFs flagged. So this reuses it
 * and drops the ETFs, rather than standing up a second universe source.
 *
 * ## What "common stock" is approximated by
 *
 * The directory does not label share class beyond the ETF flag, so what is left
 * after dropping ETFs is common stock *plus* a tail of ADRs and closed-end
 * funds that carry plain tickers. That tail is small and harmless here — an ADR
 * that gapped from a quiet base is a perfectly good watchlist name — but it is
 * not literally "US common stock only", and the page says so. The price and
 * average-volume floors in the scan itself remove the illiquid remainder.
 */

export interface EpisodicSymbol {
  symbol: string;
  name: string | null;
}

/** Same allow-list the bar fetcher's URL builder expects. */
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z]{1,2})?$/;

export interface EpisodicUniverse {
  symbols: EpisodicSymbol[];
  /** Whether the directory was the real feed or the built-in stub. */
  fromStub: boolean;
  source?: string;
  fetchedAt: string;
}

export async function getEpisodicUniverse(): Promise<EpisodicUniverse> {
  const directory = await getSymbolDirectory();

  const symbols: EpisodicSymbol[] = [];
  const seen = new Set<string>();
  for (const entry of directory.entries) {
    if (entry.e === 1) continue; // an ETF, not a common stock
    const symbol = entry.s.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push({ symbol, name: entry.n || null });
  }

  symbols.sort((a, b) => (a.symbol < b.symbol ? -1 : 1));

  // The stub the directory falls back to is a couple of dozen names — the epoch
  // `fetchedAt` is how it announces itself, and a scan run against it is a smoke
  // test, not a real sweep.
  const fromStub = new Date(directory.fetchedAt).getTime() === 0;

  return {
    symbols,
    fromStub,
    source: directory.source,
    fetchedAt: directory.fetchedAt,
  };
}
