/**
 * Sector buckets for /sectors.
 *
 * This is the file to edit. Add or remove a symbol, redeploy, and the next
 * daily run picks it up.
 *
 * Kept separate from `groups/definitions.ts` on purpose. Those three groups
 * (MAG7, SEMI, INDEX) are themes rather than sectors, and two of them overlap
 * heavily — averaging them would say more about the overlap than about
 * rotation. These are disjoint: no symbol appears twice, so a sector average
 * means what it looks like it means.
 *
 * Five to seven names each. Fewer and one earnings reaction swings the whole
 * sector; many more and the daily bar fetch stops being cheap.
 */

export interface SectorDefinition {
  id: string;
  name: string;
  /** One line a beginner can read. */
  blurb: string;
  symbols: string[];
}

export const SECTORS: SectorDefinition[] = [
  {
    id: 'bigtech',
    name: 'Big Tech',
    blurb: 'The megacaps that drive most of the index.',
    symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'],
  },
  {
    id: 'semis',
    name: 'Semiconductors',
    blurb: 'Chip makers — the cyclical engine under the tech trade.',
    symbols: ['NVDA', 'AMD', 'AVGO', 'MU', 'QCOM', 'TSM', 'INTC'],
  },
  {
    id: 'financials',
    name: 'Financials',
    blurb: 'Big banks and brokers.',
    symbols: ['JPM', 'BAC', 'GS', 'WFC', 'C'],
  },
  {
    id: 'energy',
    name: 'Energy',
    blurb: 'Oil and gas producers and services.',
    symbols: ['XOM', 'CVX', 'COP', 'OXY', 'SLB'],
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    blurb: 'Insurers, pharma and medical devices.',
    symbols: ['UNH', 'JNJ', 'LLY', 'PFE', 'ABBV'],
  },
  {
    id: 'consumer',
    name: 'Consumer',
    blurb: 'Retailers and restaurant chains.',
    symbols: ['WMT', 'COST', 'HD', 'MCD', 'NKE'],
  },
  {
    id: 'industrials',
    name: 'Industrials',
    blurb: 'Machinery, aerospace and freight.',
    symbols: ['CAT', 'BA', 'GE', 'HON', 'UPS'],
  },
  {
    id: 'comms',
    name: 'Communications',
    blurb: 'Streaming, media and telecom.',
    symbols: ['NFLX', 'DIS', 'T', 'VZ', 'CMCSA'],
  },
];

/** Every symbol across all sectors, deduplicated. */
export function allSectorSymbols(): string[] {
  return [...new Set(SECTORS.flatMap((s) => s.symbols))];
}

/**
 * Symbols listed in more than one sector.
 *
 * Surfaced rather than silently deduplicated: a symbol in two buckets makes
 * both averages partly the same number, which quietly weakens exactly the
 * comparison this page exists to make.
 */
export function duplicateSymbols(): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const symbol of SECTORS.flatMap((s) => s.symbols)) {
    if (seen.has(symbol)) twice.add(symbol);
    seen.add(symbol);
  }
  return [...twice].sort();
}
