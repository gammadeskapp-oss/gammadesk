import 'server-only';

/**
 * Tradier's batch quote endpoint — the primary source for Method A.
 *
 * Measured against the live API on 2026-08-30, with the whole 485-symbol
 * checked-in universe in a single POST: HTTP 200, 471 quotes, 132 ms. There is
 * no practical chunk limit to work around, which makes it a far better fit for
 * a once-a-minute sweep than the twenty-at-a-time fallback in `spark.ts`.
 *
 * POST rather than GET deliberately. Five hundred comma-separated symbols is a
 * four-kilobyte query string, which is inside most limits and outside some.
 *
 * ## Symbols it does not know
 *
 * The response carries `unmatched_symbols`, and this module passes that count
 * up rather than letting the names quietly vanish from the denominator. On the
 * checked-in seed list fourteen come back unmatched — JNPR, EA, K and others
 * that have since been acquired or left the index. That is a stale membership
 * list, not a broken feed: each one fails identically when requested on its
 * own, and the Yahoo fallback drops much the same set. The live membership
 * fetch keeps the real universe current; this is only ever the reason a
 * measured count sits a little under five hundred.
 *
 * ## What it does not carry
 *
 * There is no VWAP field and no intraday series — quotes are a snapshot. The
 * fifteen-minute reading is therefore built by this project from its own
 * stored prices (see `store.ts`), not read from the provider.
 *
 * It does carry a session `volume`, which /movers reads. There is also an
 * `average_volume` field alongside it, and it is deliberately not used: its
 * window is the provider's business and could change under us, whereas the
 * twenty-session average in the RS digest is computed here from bars this
 * project already stores. Relative volume has to be a ratio of two numbers
 * measured the same way, or it is not a ratio of anything.
 */

const QUOTES_URL = 'https://api.tradier.com/v1/markets/quotes';

export interface TradierQuote {
  symbol: string;
  /** Latest traded price. */
  last: number;
  /** Yesterday's closing price. */
  prevClose: number;
  /**
   * Shares traded so far in the current session, or the whole of the last one
   * after the close.
   *
   * Optional because it is genuinely absent for a symbol that has not printed
   * yet, and because breadth — the reason this module exists — does not read
   * it. The movers list does, and a missing volume there must read as "cannot
   * be graded" rather than as zero, which would compute a relative volume of
   * nought and quietly drop a real mover off the list.
   */
  volume?: number;
}

interface RawQuote {
  symbol?: string;
  last?: number | null;
  close?: number | null;
  prevclose?: number | null;
  volume?: number | null;
}

export function tradierToken(): string | undefined {
  const token = process.env.TRADIER_TOKEN?.trim();
  return token ? token : undefined;
}

export interface TradierQuotesResult {
  quotes: Map<string, TradierQuote>;
  /** Symbols the API did not recognise. */
  unmatched: string[];
}

/**
 * @throws when the request fails or the token is missing — the caller falls
 * back to the Yahoo path rather than reporting a breadth reading built from
 * nothing.
 */
export async function fetchTradierQuotes(
  symbols: string[],
  timeoutMs = 15_000,
): Promise<TradierQuotesResult> {
  const token = tradierToken();
  if (!token) throw new Error('TRADIER_TOKEN is not set.');

  const response = await fetch(QUOTES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ symbols: symbols.join(',') }).toString(),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`Tradier returned HTTP ${response.status}`);

  const body = (await response.json()) as {
    quotes?: {
      // A single symbol comes back as an object rather than an array.
      quote?: RawQuote | RawQuote[];
      unmatched_symbols?: { symbol?: string | string[] };
    };
  };

  const raw = body.quotes?.quote;
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  const quotes = new Map<string, TradierQuote>();
  for (const item of list) {
    const symbol = item.symbol;
    // `last` is null before a symbol's first print of the session; `close`
    // stands in there. Neither is invented — a symbol with no price at all is
    // simply not counted.
    const price = item.last ?? item.close;
    const prevClose = item.prevclose;
    if (!symbol || typeof price !== 'number' || typeof prevClose !== 'number') continue;
    if (!(price > 0) || !(prevClose > 0)) continue;
    const volume = item.volume;
    quotes.set(symbol, {
      symbol,
      last: price,
      prevClose,
      ...(typeof volume === 'number' && Number.isFinite(volume) && volume >= 0
        ? { volume }
        : {}),
    });
  }

  const unmatchedRaw = body.quotes?.unmatched_symbols?.symbol;
  const unmatched =
    unmatchedRaw === undefined ? [] : Array.isArray(unmatchedRaw) ? unmatchedRaw : [unmatchedRaw];

  return { quotes, unmatched };
}
