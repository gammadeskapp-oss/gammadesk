/**
 * Index membership for the S&P 500 relative-strength engine.
 *
 * This file holds the *shape* of membership plus a checked-in seed list. The
 * live list is fetched and stored weekly by `membership.ts` — see the note
 * there on sourcing.
 *
 * ## Why there is still a hardcoded list
 *
 * The seed below is what the page ranks before the first membership fetch
 * succeeds, and what it falls back to if every source is unreachable. Without
 * it a fresh deploy shows an empty page until a cron fires, and a Wikipedia
 * outage would empty a working one. It is allowed to drift; it exists so there
 * is always *a* universe, not so it is the authoritative one.
 *
 * ## Sectors
 *
 * The eleven GICS sectors, which drive the sector filter on the page. These
 * are the same buckets `sectors/definitions.ts` uses, but that file is a
 * hand-picked dozen large caps per sector for the momentum averages — this one
 * is the whole index. They stay separate on purpose: changing the RS universe
 * must not move the sector momentum scores.
 */

export type Gics =
  | 'technology'
  | 'health-care'
  | 'financials'
  | 'consumer-discretionary'
  | 'communication-services'
  | 'industrials'
  | 'consumer-staples'
  | 'energy'
  | 'utilities'
  | 'real-estate'
  | 'materials';

export const GICS_NAMES: Record<Gics, string> = {
  technology: 'Information Technology',
  'health-care': 'Health Care',
  financials: 'Financials',
  'consumer-discretionary': 'Consumer Discretionary',
  'communication-services': 'Communication Services',
  industrials: 'Industrials',
  'consumer-staples': 'Consumer Staples',
  energy: 'Energy',
  utilities: 'Utilities',
  'real-estate': 'Real Estate',
  materials: 'Materials',
};

/**
 * GICS sector names as the upstream sources spell them, mapped to our ids.
 *
 * Wikipedia and the CSV both use the official GICS wording, but they have
 * disagreed on hyphenation and on "Information Technology" versus "Technology"
 * often enough that the match is done on a squashed key rather than exactly.
 */
const SECTOR_ALIASES: Record<string, Gics> = {
  informationtechnology: 'technology',
  technology: 'technology',
  healthcare: 'health-care',
  health: 'health-care',
  financials: 'financials',
  financial: 'financials',
  consumerdiscretionary: 'consumer-discretionary',
  consumerstaples: 'consumer-staples',
  communicationservices: 'communication-services',
  telecommunicationservices: 'communication-services',
  industrials: 'industrials',
  energy: 'energy',
  utilities: 'utilities',
  realestate: 'real-estate',
  materials: 'materials',
};

/** Resolve an upstream sector string, or null if it is not one we know. */
export function toGics(raw: string): Gics | null {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  return SECTOR_ALIASES[key] ?? null;
}

export interface Constituent {
  symbol: string;
  sector: Gics | null;
  /** Which storage shard holds this symbol's bars. Stable for the symbol's life. */
  shard: number;
}

/** Same allow-list the bar fetchers use, so a typo cannot reach a URL. */
export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z]{1,2})?$/;

/**
 * Storage shards.
 *
 * Bars for 500 symbols over ten years are far too much for one JSON document
 * to read and rewrite inside a 60-second function, so the store is split and a
 * refresh touches exactly one shard. Four shards at roughly 125 symbols each
 * lines up with four cron firings an evening, which is what makes the whole
 * universe refresh daily without ever fetching all 500 at once.
 */
export const SHARDS = 4;

/**
 * FNV-1a, taken modulo the shard count.
 *
 * Hashed rather than assigned by position in the membership list, because that
 * list is now refetched weekly and its order is not ours to control. Position
 * would mean one addition at the top shifts every symbol below it into a
 * different shard, and each displaced symbol would read as having no stored
 * history and need a full ten-year backfill. Hashing means a reconstitution
 * re-backfills only the names that actually changed.
 */
export function shardOf(symbol: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < symbol.length; i += 1) {
    hash ^= symbol.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % SHARDS;
}

/**
 * Yahoo writes class shares with a dash (`BRK-B`); Wikipedia, the CSV and every
 * human write them with a dot. The dot is what we store and display, and this
 * is the only place the other convention exists.
 */
export function yahooSymbol(symbol: string): string {
  return symbol.replace('.', '-');
}

/** Clean, deduplicate and shard a raw membership list. */
export function toConstituents(
  raw: Array<{ symbol: string; sector?: string | null }>,
): Constituent[] {
  const seen = new Set<string>();
  const out: Constituent[] = [];

  for (const item of raw) {
    const symbol = item.symbol.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      sector: item.sector ? toGics(item.sector) : null,
      shard: shardOf(symbol),
    });
  }

  return out;
}

/**
 * Fallback membership, by sector.
 *
 * Only read when no stored list exists and every upstream is unreachable. Kept
 * roughly current by hand; see the file header for why it is allowed to drift.
 */
const SEED_BY_SECTOR: Record<Gics, string[]> = {
  technology: [
    'AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE', 'ACN', 'CSCO',
    'INTU', 'IBM', 'QCOM', 'TXN', 'NOW', 'AMAT', 'MU', 'ADI', 'LRCX', 'KLAC',
    'PANW', 'SNPS', 'CDNS', 'ANET', 'APH', 'MSI', 'ROP', 'FTNT', 'NXPI', 'IT',
    'ADSK', 'MCHP', 'CTSH', 'GLW', 'HPQ', 'HPE', 'DELL', 'WDC', 'STX', 'KEYS',
    'TEL', 'TDY', 'ZBRA', 'TER', 'SWKS', 'MPWR', 'ON', 'JNPR', 'AKAM', 'FFIV',
    'NTAP', 'EPAM', 'PTC', 'ANSS', 'TYL', 'VRSN', 'GEN', 'CDW', 'JBL', 'SMCI',
    'FSLR', 'ENPH', 'TRMB', 'GDDY', 'APP', 'PLTR', 'CRWD', 'INTC', 'GRMN', 'NTNX',
  ],
  'communication-services': [
    'GOOGL', 'GOOG', 'META', 'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS', 'CHTR',
    'EA', 'TTWO', 'WBD', 'OMC', 'IPG', 'LYV', 'NWSA', 'NWS', 'FOXA', 'FOX',
    'MTCH',
  ],
  'consumer-discretionary': [
    'AMZN', 'TSLA', 'HD', 'MCD', 'BKNG', 'LOW', 'TJX', 'NKE', 'SBUX', 'CMG',
    'ORLY', 'AZO', 'ROST', 'MAR', 'HLT', 'GM', 'F', 'YUM', 'DHI', 'LEN',
    'NVR', 'PHM', 'RCL', 'CCL', 'NCLH', 'ABNB', 'DASH', 'EBAY', 'EXPE', 'KMX',
    'BBY', 'DPZ', 'DRI', 'LVS', 'WYNN', 'MGM', 'APTV', 'BWA', 'LKQ', 'POOL',
    'TSCO', 'ULTA', 'WSM', 'TPR', 'RL', 'DECK', 'LULU', 'HAS', 'MHK', 'CZR',
    'GPC',
  ],
  'consumer-staples': [
    'PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MO', 'MDLZ', 'CL', 'KMB',
    'GIS', 'KR', 'SYY', 'STZ', 'KDP', 'KHC', 'HSY', 'CHD', 'MKC', 'CAG',
    'CPB', 'SJM', 'TAP', 'TSN', 'HRL', 'K', 'ADM', 'BG', 'CLX', 'EL',
    'DG', 'DLTR', 'LW', 'MNST', 'BF.B',
  ],
  'health-care': [
    'LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'PFE', 'AMGN',
    'BMY', 'SYK', 'BSX', 'MDT', 'GILD', 'VRTX', 'REGN', 'ISRG', 'CI', 'CVS',
    'ELV', 'HUM', 'CNC', 'MCK', 'COR', 'CAH', 'ZTS', 'BDX', 'EW', 'A',
    'IQV', 'IDXX', 'RMD', 'DXCM', 'MTD', 'WAT', 'WST', 'BIO', 'TECH', 'HOLX',
    'BAX', 'ZBH', 'STE', 'PODD', 'ALGN', 'CRL', 'VTRS', 'MRNA', 'INCY', 'UHS',
    'HCA', 'DVA', 'LH', 'DGX', 'SOLV', 'GEHC', 'RVTY', 'MOH',
  ],
  financials: [
    'BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'SCHW', 'AXP',
    'C', 'BLK', 'SPGI', 'CB', 'PGR', 'MMC', 'AON', 'ICE', 'CME', 'MCO',
    'AJG', 'TRV', 'AFL', 'ALL', 'MET', 'PRU', 'PNC', 'USB', 'TFC', 'COF',
    'BK', 'STT', 'NTRS', 'FITB', 'HBAN', 'RF', 'CFG', 'KEY', 'MTB', 'ZION',
    'CMA', 'SYF', 'AIG', 'HIG', 'L', 'GL', 'PFG', 'AMP', 'TROW', 'BEN',
    'IVZ', 'NDAQ', 'CBOE', 'MSCI', 'FDS', 'MKTX', 'ACGL', 'RJF', 'WRB', 'EG',
    'BRO', 'CINF', 'AIZ', 'ERIE', 'FI', 'FIS', 'GPN', 'JKHY', 'PYPL', 'COIN',
  ],
  industrials: [
    'GE', 'CAT', 'RTX', 'HON', 'UNP', 'BA', 'UPS', 'DE', 'LMT', 'ADP',
    'ETN', 'EMR', 'NOC', 'GD', 'ITW', 'CSX', 'NSC', 'FDX', 'WM', 'PH',
    'TT', 'CMI', 'PCAR', 'ROK', 'AME', 'FAST', 'ODFL', 'VRSK', 'EFX', 'CTAS',
    'GWW', 'IR', 'DOV', 'XYL', 'LHX', 'TDG', 'HWM', 'AXON', 'PWR', 'URI',
    'J', 'ACM', 'MAS', 'ALLE', 'JCI', 'CARR', 'OTIS', 'PNR', 'SWK', 'SNA',
    'TXT', 'LDOS', 'HII', 'BLDR', 'EXPD', 'CHRW', 'LUV', 'DAL', 'UAL', 'AAL',
    'ALK', 'CPRT', 'RSG', 'PAYX', 'BR', 'VLTO', 'GNRC', 'AOS', 'NDSN', 'ROL',
    'WAB', 'FTV', 'HUBB', 'DAY', 'PAYC',
  ],
  energy: [
    'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'PSX', 'MPC', 'VLO', 'OXY', 'WMB',
    'KMI', 'OKE', 'HAL', 'BKR', 'DVN', 'FANG', 'CTRA', 'APA', 'EQT', 'TRGP',
    'EXE',
  ],
  utilities: [
    'NEE', 'SO', 'DUK', 'CEG', 'AEP', 'D', 'SRE', 'EXC', 'XEL', 'ED',
    'PEG', 'WEC', 'ES', 'AWK', 'DTE', 'PPL', 'AEE', 'CMS', 'FE', 'ATO',
    'CNP', 'NI', 'LNT', 'EVRG', 'PNW', 'AES', 'NRG', 'VST',
  ],
  'real-estate': [
    'PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'PSA', 'O', 'CCI', 'DLR', 'VTR',
    'AVB', 'EQR', 'EXR', 'IRM', 'SBAC', 'ARE', 'MAA', 'ESS', 'UDR', 'KIM',
    'REG', 'HST', 'BXP', 'DOC', 'CPT', 'WY', 'VICI', 'CBRE', 'CSGP', 'FRT',
  ],
  materials: [
    'LIN', 'SHW', 'APD', 'ECL', 'FCX', 'NEM', 'DOW', 'DD', 'PPG', 'NUE',
    'VMC', 'MLM', 'IFF', 'ALB', 'AMCR', 'AVY', 'BALL', 'CE', 'CF', 'EMN',
    'IP', 'PKG', 'SW', 'STLD', 'LYB', 'MOS',
  ],
};

let cachedSeed: Constituent[] | null = null;

/** The checked-in fallback universe. */
export function seedConstituents(): Constituent[] {
  if (cachedSeed) return cachedSeed;

  const raw: Array<{ symbol: string; sector: string }> = [];
  for (const [sector, symbols] of Object.entries(SEED_BY_SECTOR) as [Gics, string[]][]) {
    for (const symbol of symbols) raw.push({ symbol, sector });
  }

  cachedSeed = toConstituents(raw);
  return cachedSeed;
}

/** The symbols belonging to one shard, in list order. */
export function shardSymbols(members: Constituent[], shard: number): string[] {
  return members.filter((c) => c.shard === shard).map((c) => c.symbol);
}

/** Symbol to sector, for the ranking and the sector filter. */
export function sectorMap(members: Constituent[]): Map<string, Gics> {
  const map = new Map<string, Gics>();
  for (const c of members) if (c.sector) map.set(c.symbol, c.sector);
  return map;
}
