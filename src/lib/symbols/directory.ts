import 'server-only';

import { cached } from '../cache';
import { allTrackedSymbols } from '../groups/definitions';
import { createJsonStore } from '../jsonStore';

/**
 * The US symbol directory that backs ticker autocomplete.
 *
 * Primary source is Nasdaq Trader's published symbol files: every listed US
 * name including NYSE and the ETFs, no API key, two plain pipe-delimited
 * downloads, and company names already written for humans. Polygon could
 * answer the same question but its stocks endpoints are rate limited to five
 * requests a minute even on the paid options plan, and the directory would
 * take eleven paginated calls.
 *
 * SEC's EDGAR ticker file is kept as a second source, on a different host.
 * That is not defensive decoration — the Nasdaq host failed TLS verification
 * during development (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) while every other
 * request on the machine succeeded, and a single unauthenticated third party
 * is a poor thing to hang a headline feature on. Its names are shoutier and it
 * misses a few ETFs, which is why it is second rather than first.
 *
 * Whichever wins is fetched at most once a week and kept in the durable store,
 * so a cold lambda reads roughly 300KB of JSON from Blob rather than 1.5MB of
 * text from someone else — and keeps working on a day when they are down.
 */

const FEEDS = {
  nasdaq: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
  other: 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',
  sec: 'https://www.sec.gov/files/company_tickers_exchange.json',
} as const;

/** SEC asks automated clients to identify themselves. */
const USER_AGENT = 'GammaDesk/1.0 (+https://gammadesk.app)';

/** How long a stored copy is used before trying upstream again. */
const MAX_AGE_DAYS = 7;
/** In-process cache. Listings change slowly; this only guards a cold start. */
const MEMORY_TTL_SECONDS = 12 * 60 * 60;
/** How long to leave a failing feed alone before trying it again. */
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

export interface SymbolEntry {
  /** Ticker, upper case. */
  s: string;
  /** Company name, cleaned of listing boilerplate. */
  n: string;
  /** 1 when the listing is an ETF. */
  e?: 1;
}

export interface SymbolDirectory {
  fetchedAt: string;
  /** Which feed produced this copy. Reported by /api/health. */
  source?: string;
  entries: SymbolEntry[];
}

// --- parsing ----------------------------------------------------------------

/**
 * Trailing security-type boilerplate.
 *
 * "Apple Inc. - Common Stock" and "Agilent Technologies, Inc. Common Stock"
 * both want to read as the company, which is the only part a beginner
 * recognises. Anchored to the end so a company actually called something like
 * "Common Stock Holdings" keeps its name.
 */
const BOILERPLATE =
  /(?:\s*-\s*|\s+)(?:(?:Class\s+[A-Z]\s+)?(?:Common\s+Stock|Ordinary\s+Shares?|Common\s+Shares?|American\s+Depositary\s+Shares?|Depositary\s+Shares?)|Class\s+[A-Z])\s*$/i;

function cleanName(raw: string): string {
  let name = raw.trim();
  // Applied twice: "Foo Inc. - Class A Common Stock" sheds the type, then the
  // class.
  name = name.replace(BOILERPLATE, '').replace(BOILERPLATE, '');
  return name.replace(/[\s,\-]+$/, '').trim();
}

/**
 * Only plain one-to-five-letter tickers.
 *
 * Everything else in these files is a warrant, unit, right or preferred
 * series, carrying suffixes like `ABC$A` or `ABC.WS`. None of them have an
 * options chain worth looking at here, and dropping them roughly halves the
 * list.
 */
const PLAIN_TICKER = /^[A-Z]{1,5}$/;

interface FeedShape {
  symbol: number;
  name: number;
  etf: number;
  test: number;
}

/** Only the two pipe-delimited feeds; the SEC one is JSON and parsed apart. */
const SHAPES: Record<'nasdaq' | 'other', FeedShape> = {
  // Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot|ETF|NextShares
  nasdaq: { symbol: 0, name: 1, etf: 6, test: 3 },
  // ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot|Test Issue|NASDAQ Symbol
  other: { symbol: 0, name: 1, etf: 4, test: 6 },
};

function parseFeed(text: string, shape: FeedShape): SymbolEntry[] {
  const out: SymbolEntry[] = [];

  for (const line of text.split(/\r?\n/)) {
    // The header, blanks, and the "File Creation Time" footer.
    if (!line || !line.includes('|') || line.startsWith('File Creation Time')) {
      continue;
    }

    const cols = line.split('|');
    const symbol = (cols[shape.symbol] ?? '').trim().toUpperCase();
    if (!PLAIN_TICKER.test(symbol)) continue;
    if ((cols[shape.test] ?? '').trim().toUpperCase() === 'Y') continue;

    const name = cleanName(cols[shape.name] ?? '');
    if (!name) continue;

    const entry: SymbolEntry = { s: symbol, n: name };
    if ((cols[shape.etf] ?? '').trim().toUpperCase() === 'Y') entry.e = 1;
    out.push(entry);
  }

  return out;
}

// --- storage ----------------------------------------------------------------

function isDirectory(raw: unknown): SymbolDirectory | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<SymbolDirectory>;
  if (typeof d.fetchedAt !== 'string' || !Array.isArray(d.entries)) return null;
  if (d.entries.length === 0) return null;
  const first = d.entries[0] as Partial<SymbolEntry>;
  if (typeof first?.s !== 'string' || typeof first?.n !== 'string') return null;
  return d as SymbolDirectory;
}

const store = createJsonStore<SymbolDirectory | null>(
  'gammadesk/symbols.json',
  () => null,
  isDirectory,
);

/**
 * Last-resort directory.
 *
 * If the feed is unreachable and nothing has ever been stored, the search box
 * still has to do something useful, so it falls back to the names the site
 * already tracks. Better a short list than a dead input.
 */
function builtinFallback(): SymbolDirectory {
  const names: Record<string, string> = {
    SPY: 'SPDR S&P 500 ETF Trust',
    QQQ: 'Invesco QQQ Trust',
    IWM: 'iShares Russell 2000 ETF',
    DIA: 'SPDR Dow Jones Industrial Average ETF',
    AAPL: 'Apple Inc.',
    MSFT: 'Microsoft Corporation',
    NVDA: 'NVIDIA Corporation',
    AMZN: 'Amazon.com, Inc.',
    GOOGL: 'Alphabet Inc.',
    META: 'Meta Platforms, Inc.',
    TSLA: 'Tesla, Inc.',
    AMD: 'Advanced Micro Devices, Inc.',
    AVGO: 'Broadcom Inc.',
    QCOM: 'QUALCOMM Incorporated',
    MU: 'Micron Technology, Inc.',
    TSM: 'Taiwan Semiconductor Manufacturing Company',
    INTC: 'Intel Corporation',
    AMAT: 'Applied Materials, Inc.',
    LRCX: 'Lam Research Corporation',
    KLAC: 'KLA Corporation',
  };

  return {
    fetchedAt: new Date(0).toISOString(),
    entries: allTrackedSymbols().map((s) => ({ s, n: names[s] ?? s })),
  };
}

// --- loading ----------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    // Far too big for Next's data cache, and cached by us anyway.
    cache: 'no-store',
    headers: { accept: '*/*', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.text();
}

async function loadNasdaq(): Promise<SymbolEntry[]> {
  const [nasdaq, other] = await Promise.all([
    fetchText(FEEDS.nasdaq),
    fetchText(FEEDS.other),
  ]);

  const merged = new Map<string, SymbolEntry>();
  for (const entry of parseFeed(nasdaq, SHAPES.nasdaq)) merged.set(entry.s, entry);
  // A handful of symbols appear in both files; either row will do.
  for (const entry of parseFeed(other, SHAPES.other)) {
    if (!merged.has(entry.s)) merged.set(entry.s, entry);
  }
  return [...merged.values()];
}

/** EDGAR state-of-incorporation suffixes, e.g. "BANK OF AMERICA CORP /DE/". */
const EDGAR_SUFFIX = /\s*\/[A-Z]{2,3}\/\s*$/;

const ACRONYMS = new Set([
  'ETF', 'SPDR', 'USA', 'US', 'UK', 'PLC', 'LP', 'LLC', 'NV', 'SA', 'AG',
  'REIT', 'ADR', 'AB', 'AI', 'II', 'III', 'IV', 'CO', 'DE',
]);

/**
 * EDGAR names are frequently shouted. Softened only when there is no lower
 * case at all, so a name already written properly is left alone.
 */
function tidySecName(raw: string): string {
  const name = raw.replace(EDGAR_SUFFIX, '').replace(/\s+/g, ' ').trim();
  if (/[a-z]/.test(name)) return name;

  return name
    .split(' ')
    .map((word) => {
      const bare = word.replace(/[^A-Z&]/g, '');
      if (ACRONYMS.has(bare) || /&/.test(word)) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(' ');
}

async function loadSec(): Promise<SymbolEntry[]> {
  const body = JSON.parse(await fetchText(FEEDS.sec)) as {
    fields?: string[];
    data?: unknown[][];
  };

  const fields = body.fields ?? [];
  const ti = fields.indexOf('ticker');
  const ni = fields.indexOf('name');
  if (ti < 0 || ni < 0 || !Array.isArray(body.data)) {
    throw new Error('SEC ticker file did not have the expected shape');
  }

  const out: SymbolEntry[] = [];
  for (const row of body.data) {
    const symbol = String(row[ti] ?? '').trim().toUpperCase();
    if (!PLAIN_TICKER.test(symbol)) continue;
    const name = tidySecName(String(row[ni] ?? ''));
    if (name) out.push({ s: symbol, n: name });
  }
  return out;
}

const SOURCES: { name: string; load: () => Promise<SymbolEntry[]> }[] = [
  { name: 'nasdaqtrader', load: loadNasdaq },
  { name: 'sec-edgar', load: loadSec },
];

/** Below this, assume something is broken rather than publish a stub. */
const MIN_ENTRIES = 1000;

async function fetchUpstream(): Promise<SymbolDirectory> {
  let lastError: unknown = new Error('No symbol source configured');

  for (const source of SOURCES) {
    try {
      const entries = await source.load();
      if (entries.length < MIN_ENTRIES) {
        throw new Error(`only ${entries.length} symbols`);
      }

      const merged = new Map(entries.map((e) => [e.s, e]));
      return {
        fetchedAt: new Date().toISOString(),
        source: source.name,
        entries: [...merged.values()].sort((a, b) => (a.s < b.s ? -1 : 1)),
      };
    } catch (error) {
      lastError = error;
      // Logged rather than swallowed: a silent fall through to the next source
      // is exactly how you end up not knowing the primary has been broken for
      // a month.
      console.warn(`[symbols] source "${source.name}" failed:`, describe(error));
    }
  }

  throw lastError;
}

/** fetch() failures hide the useful part in `cause`. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code ?? cause?.message;
  return detail ? `${error.message} (${detail})` : error.message;
}

const dayMs = 24 * 60 * 60 * 1000;

/** Set after a failed fetch so a dead feed is not retried on every keystroke. */
let retryAfter = 0;

async function load(): Promise<SymbolDirectory> {
  const stored = await store.read().catch(() => null);

  const ageDays = stored
    ? (Date.now() - new Date(stored.fetchedAt).getTime()) / dayMs
    : Infinity;

  if (stored && ageDays < MAX_AGE_DAYS) return stored;

  if (Date.now() < retryAfter) {
    // Any stored copy beats no copy, however old.
    if (stored) return stored;
    throw new Error('Symbol directory unavailable, upstream in cooldown');
  }

  try {
    const fresh = await fetchUpstream();
    retryAfter = 0;
    // A write failure must not cost us a directory we already have in hand.
    await store.write(fresh).catch(() => {});
    return fresh;
  } catch (error) {
    retryAfter = Date.now() + FAILURE_COOLDOWN_MS;
    if (stored) return stored;
    throw error;
  }
}

/**
 * Note what this deliberately does not do: cache a failure.
 *
 * `load` throws rather than returning the stub when it has nothing real, so
 * `cached` never stores it — a half-second outage during a cold start would
 * otherwise leave every search box crippled for the full twelve hours, which
 * is exactly the kind of failure nobody notices until a user complains. The
 * stub is substituted here, outside the cache, and `retryAfter` is what stops
 * the retry becoming a hammer.
 */
export async function getSymbolDirectory(): Promise<SymbolDirectory> {
  try {
    return await cached('symbols.directory', MEMORY_TTL_SECONDS, load);
  } catch (error) {
    console.warn('[symbols] serving the built-in stub:', describe(error));
    return builtinFallback();
  }
}
