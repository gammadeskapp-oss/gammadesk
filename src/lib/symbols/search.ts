import type { SymbolEntry } from './directory';

/**
 * Ranked symbol + company-name matching.
 *
 * Deliberately not a fuzzy matcher. Someone typing `AAP` wants AAPL at the
 * top, not a clever edit-distance hit on a company nobody has heard of, and a
 * beginner typing `apple` wants the same row. Everything below is about making
 * those two cases land first.
 */

export interface SymbolMatch {
  symbol: string;
  name: string;
  isEtf: boolean;
}

/**
 * Names a beginner is most likely to mean, floated above equally good matches.
 *
 * The directory carries no volume or market-cap data, so without this the
 * letter `s` leads with whatever sorts first alphabetically rather than SPY.
 * These are the index ETFs and megacaps the rest of the site already tracks.
 */
const POPULAR = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI',
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA',
  'AMD', 'AVGO', 'NFLX', 'INTC', 'MU', 'QCOM', 'TSM', 'JPM', 'V', 'WMT',
];
const POPULAR_RANK = new Map(POPULAR.map((s, i) => [s, i]));

/*
 * Tiers, best first. The gaps are wide enough that no popularity bonus can
 * lift a name match above a symbol match.
 */
const EXACT_SYMBOL = 0;
const SYMBOL_PREFIX = 100;
const NAME_WORD_PREFIX = 200;
const SYMBOL_CONTAINS = 300;
const NAME_CONTAINS = 400;
const NO_MATCH = Infinity;

/** Where in `name` a word starts with `q`, or -1. */
function wordPrefixIndex(name: string, q: string): number {
  let from = 0;
  for (;;) {
    const at = name.indexOf(q, from);
    if (at < 0) return -1;
    // Start of string, or preceded by something that ends a word.
    if (at === 0 || /[\s(.,\-/&]/.test(name[at - 1])) return at;
    from = at + 1;
  }
}

function score(entry: SymbolEntry, q: string): number {
  const symbol = entry.s;
  const name = entry.n.toLowerCase();

  // Popularity only ever breaks a tie inside a tier.
  const boost = (POPULAR_RANK.get(symbol) ?? 99) / 100;

  if (symbol === q) return EXACT_SYMBOL + boost;
  if (symbol.startsWith(q)) {
    // Shorter symbols first: for `A`, A beats AA beats AAPL.
    return SYMBOL_PREFIX + symbol.length + boost;
  }

  const lower = q.toLowerCase();
  const wordAt = wordPrefixIndex(name, lower);
  // Matching the first word beats matching the fourth.
  if (wordAt >= 0) return NAME_WORD_PREFIX + Math.min(wordAt, 60) + boost;

  if (symbol.includes(q)) return SYMBOL_CONTAINS + symbol.length + boost;

  const at = name.indexOf(lower);
  if (at >= 0) return NAME_CONTAINS + Math.min(at, 60) + boost;

  return NO_MATCH;
}

export function searchSymbols(
  entries: SymbolEntry[],
  query: string,
  limit = 8,
): SymbolMatch[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const scored: { entry: SymbolEntry; rank: number }[] = [];

  for (const entry of entries) {
    const rank = score(entry, q);
    if (rank !== NO_MATCH) scored.push({ entry, rank });
  }

  scored.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank : a.entry.s < b.entry.s ? -1 : 1,
  );

  return scored.slice(0, limit).map(({ entry }) => ({
    symbol: entry.s,
    name: entry.n,
    isEtf: entry.e === 1,
  }));
}
