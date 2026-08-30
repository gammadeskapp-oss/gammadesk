import 'server-only';

/**
 * Yahoo's multi-symbol "spark" endpoint, and why it is the one used.
 *
 * The breadth meter needs a price and a prior close for five hundred symbols,
 * once every refresh. Fetching them one at a time is five hundred requests, so
 * a genuinely multi-symbol endpoint is the whole feasibility of Method A.
 *
 * Three candidates were tested against the live feed on 2026-08-30:
 *
 * - `/v7/finance/quote?symbols=…` — **HTTP 401 Unauthorized.** The documented
 *   batch quote route now requires a session Yahoo does not hand out.
 * - `/v8/finance/chart/{symbol}` — works, and is what the rest of this project
 *   uses, but it is one symbol per request.
 * - `/v8/finance/spark?symbols=…` — **works.** Twenty symbols per request, hard
 *   limit ("Number of symbols needs to be less than or equal to 20"). All 485
 *   checked-in constituents came back in 25 chunks in 1.6 seconds.
 *
 * So spark it is, chunked at twenty.
 *
 * ## What spark does not return
 *
 * Its payload is `timestamp[]`, `close[]` and `previousClose` — there is no
 * volume, and no open/high/low. That is the reason this module cannot produce
 * a volume-weighted average price for the universe, and why the field it does
 * produce is named `pctAboveSessionAverage` rather than being passed off as
 * VWAP. See `universe.ts`.
 */

/** Yahoo's own cap. Requests above it are rejected outright, not truncated. */
export const SPARK_CHUNK = 20;

/** Chunks in flight at once. Yahoo drew 429s at ten with no pause; six with a
 *  short pause between waves has been quiet. Same posture as the RS refresh. */
const CONCURRENCY = 6;
/** Breather between waves, milliseconds. */
const WAVE_PAUSE_MS = 120;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export interface SparkSeries {
  symbol: string;
  /** Session closes so far, nulls already dropped, oldest first. */
  closes: number[];
  /** Seconds since epoch, aligned with `closes`. */
  stamps: number[];
  /** Yesterday's closing price. */
  previousClose: number;
  /** Bar spacing in seconds, as Yahoo reports it. */
  granularity: number;
}

interface RawSpark {
  symbol?: string;
  timestamp?: number[];
  close?: (number | null)[];
  previousClose?: number;
  chartPreviousClose?: number;
  dataGranularity?: number;
}

/**
 * Yahoo writes class shares with a dash (`BRK-B`); this project stores the dot
 * form. Same rule as `rs/universe.ts`, repeated rather than imported so the
 * breadth module does not reach into the RS engine for a one-line transform.
 */
export function yahooSymbol(symbol: string): string {
  return symbol.replace('.', '-');
}

function parse(raw: RawSpark, symbol: string): SparkSeries | null {
  const prior = raw.previousClose ?? raw.chartPreviousClose;
  if (typeof prior !== 'number' || !Number.isFinite(prior) || prior <= 0) return null;

  const closes: number[] = [];
  const stamps: number[] = [];
  const stamped = raw.timestamp ?? [];

  for (let i = 0; i < (raw.close?.length ?? 0); i += 1) {
    const c = raw.close?.[i];
    // Yahoo pads gaps and halts with nulls. Dropped, never carried forward —
    // a filled price is a price that never traded.
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
    closes.push(c);
    stamps.push(stamped[i] ?? 0);
  }

  if (closes.length === 0) return null;

  return {
    symbol,
    closes,
    stamps,
    previousClose: prior,
    granularity: raw.dataGranularity ?? 300,
  };
}

async function fetchChunk(
  symbols: string[],
  interval: string,
  signal: AbortSignal,
): Promise<Map<string, SparkSeries>> {
  const url =
    'https://query1.finance.yahoo.com/v8/finance/spark' +
    `?symbols=${symbols.map((s) => encodeURIComponent(yahooSymbol(s))).join(',')}` +
    `&range=1d&interval=${interval}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    signal,
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`Yahoo spark returned HTTP ${response.status}`);

  const body = (await response.json()) as Record<string, RawSpark>;
  const out = new Map<string, SparkSeries>();

  for (const symbol of symbols) {
    // Keyed by the Yahoo spelling; returned under the caller's spelling, so
    // BRK.B goes in and BRK.B comes back.
    const raw = body[yahooSymbol(symbol)] ?? body[symbol];
    if (!raw) continue;
    const parsed = parse(raw, symbol);
    if (parsed) out.set(symbol, parsed);
  }

  return out;
}

export interface SparkResult {
  series: Map<string, SparkSeries>;
  /** Chunks that threw or answered with an error status. */
  failedChunks: number;
  requests: number;
}

/**
 * Fetch every symbol, twenty at a time.
 *
 * A failed chunk is counted and skipped rather than aborting the sweep. Twenty
 * missing names out of five hundred moves a percentage by a fraction of a
 * point; refusing to report breadth at all because one request timed out would
 * be the worse trade. The count is carried to the page so a badly degraded
 * sweep can be said out loud rather than quietly averaged over.
 */
export async function fetchSparks(
  symbols: string[],
  options: { interval?: string; timeoutMs?: number } = {},
): Promise<SparkResult> {
  const interval = options.interval ?? '5m';
  const controller = AbortSignal.timeout(options.timeoutMs ?? 20_000);

  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += SPARK_CHUNK) {
    chunks.push(symbols.slice(i, i + SPARK_CHUNK));
  }

  const series = new Map<string, SparkSeries>();
  let failedChunks = 0;
  let requests = 0;

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      wave.map(async (chunk) => {
        requests += 1;
        try {
          return await fetchChunk(chunk, interval, controller);
        } catch {
          failedChunks += 1;
          return null;
        }
      }),
    );

    for (const result of settled) {
      if (!result) continue;
      for (const [symbol, value] of result) series.set(symbol, value);
    }

    if (i + CONCURRENCY < chunks.length) {
      await new Promise((resolve) => setTimeout(resolve, WAVE_PAUSE_MS));
    }
  }

  return { series, failedChunks, requests };
}
