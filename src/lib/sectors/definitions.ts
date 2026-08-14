/**
 * Sector buckets for /sectors and its drill-in pages.
 *
 * This is the file to edit. Add or remove a symbol, redeploy, and the next
 * daily run picks it up.
 *
 * ## GICS, not themes
 *
 * The eleven standard GICS sectors, because membership is public and
 * unambiguous. Hand-curated themes (Photonics, GLP-1, Drones) need constituent
 * lists somebody has to maintain, and a wrong tag silently corrupts the sector
 * score with no way for a reader to notice. Themes can come later behind their
 * own toggle, once the tagging is trusted.
 *
 * ## Disjoint on purpose
 *
 * No symbol appears twice, so a sector average means what it looks like it
 * means and the sectors can be compared against each other. `duplicateSymbols`
 * reports any slip rather than quietly deduplicating it.
 *
 * ## Size
 *
 * Around a dozen large caps each. Fewer and one earnings reaction swings the
 * sector; many more and the nightly bar fetch stops being cheap. Note the
 * consequence for the drill-in: a sector needs thirty constituents before it
 * splits into a top and bottom fifteen, so at this size every sector shows one
 * ranked list instead.
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
    id: 'technology',
    name: 'Information Technology',
    blurb: 'Chips, software and the hardware everything else runs on.',
    symbols: [
      'AAPL', 'MSFT', 'NVDA', 'AVGO', 'AMD', 'CRM',
      'ORCL', 'ADBE', 'CSCO', 'ACN', 'TXN', 'QCOM', 'MU', 'AMAT', 'INTC',
    ],
  },
  {
    id: 'health-care',
    name: 'Health Care',
    blurb: 'Insurers, drugmakers and medical devices.',
    symbols: [
      'UNH', 'JNJ', 'LLY', 'ABBV', 'MRK', 'PFE',
      'TMO', 'ABT', 'DHR', 'AMGN', 'BMY', 'CVS',
    ],
  },
  {
    id: 'financials',
    name: 'Financials',
    blurb: 'Banks, brokers, insurers and card networks.',
    symbols: [
      'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C',
      'SCHW', 'BLK', 'AXP', 'SPGI', 'CB', 'PGR',
    ],
  },
  {
    id: 'consumer-discretionary',
    name: 'Consumer Discretionary',
    blurb: 'What people buy when they feel comfortable spending.',
    symbols: [
      'AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW',
      'SBUX', 'BKNG', 'TJX', 'GM', 'F', 'MAR',
    ],
  },
  {
    id: 'communication-services',
    name: 'Communication Services',
    blurb: 'Search, social, streaming and telecom.',
    symbols: [
      'GOOGL', 'META', 'NFLX', 'DIS', 'CMCSA', 'T',
      'VZ', 'TMUS', 'EA', 'WBD', 'OMC', 'LYV',
    ],
  },
  {
    id: 'industrials',
    name: 'Industrials',
    blurb: 'Machinery, aerospace, rail and freight.',
    symbols: [
      'CAT', 'BA', 'GE', 'HON', 'UPS', 'RTX',
      'LMT', 'DE', 'UNP', 'MMM', 'ETN', 'ADP',
    ],
  },
  {
    id: 'consumer-staples',
    name: 'Consumer Staples',
    blurb: 'The things people buy regardless of the economy.',
    symbols: [
      'WMT', 'COST', 'PG', 'KO', 'PEP', 'PM',
      'MO', 'MDLZ', 'CL', 'KMB', 'GIS', 'KR',
    ],
  },
  {
    id: 'energy',
    name: 'Energy',
    blurb: 'Oil and gas producers, refiners and services.',
    symbols: [
      'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX',
      'MPC', 'VLO', 'OXY', 'WMB', 'KMI', 'HAL',
    ],
  },
  {
    id: 'utilities',
    name: 'Utilities',
    blurb: 'Power and gas networks — the defensive corner.',
    symbols: [
      'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC',
      'SRE', 'XEL', 'ED', 'PEG', 'WEC', 'ES',
    ],
  },
  {
    id: 'real-estate',
    name: 'Real Estate',
    blurb: 'Landlords, data centres and cell towers.',
    symbols: [
      'PLD', 'AMT', 'EQIX', 'CCI', 'PSA', 'SPG',
      'O', 'WELL', 'DLR', 'AVB', 'EQR', 'VTR',
    ],
  },
  {
    id: 'materials',
    name: 'Materials',
    blurb: 'Chemicals, metals, mining and packaging.',
    symbols: [
      'LIN', 'APD', 'SHW', 'ECL', 'FCX', 'NEM',
      'DOW', 'DD', 'PPG', 'NUE', 'VMC', 'MLM',
    ],
  },
];

/** Every symbol across all sectors, deduplicated. */
export function allSectorSymbols(): string[] {
  return [...new Set(SECTORS.flatMap((s) => s.symbols))];
}

/** Look a sector up by its URL slug. */
export function sectorById(id: string): SectorDefinition | undefined {
  return SECTORS.find((s) => s.id === id);
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
