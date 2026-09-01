import 'server-only';

import { config } from './config';
import {
  ChainError,
  resolveIvSurface,
  trimToWindow,
  type ChainSnapshot,
  type RawQuote,
} from './chainSource';
import type { OptionType } from './types';

/**
 * Cboe delayed option-chain adapter.
 *
 * Cboe publishes the chain that powers its own public quote pages on a CDN.
 * It needs no API key and returns the entire book — for SPY that is ~14,000
 * contracts including open interest, implied volatility and greeks — in a
 * single request.
 *
 * This is the default source because open interest, which every number on this
 * dashboard is built from, is not available on Polygon's free plan at all;
 * its options snapshot endpoints return 403 NOT_AUTHORIZED there.
 *
 * Caveats, stated plainly:
 *  - The endpoint is undocumented and carries no SLA. It can change or start
 *    refusing traffic without notice, which is why the app degrades to sample
 *    data rather than erroring out.
 *  - Quotes are delayed, and the payload carries its own timestamp, which is
 *    what the "data as of" stamp in the UI reports.
 */

const CDN = 'https://cdn.cboe.com/api/global/delayed_quotes/options';

/**
 * Cboe files index-option chains under a leading underscore and everything
 * else under the plain root symbol.
 */
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'VIX', 'VIXW', 'NDX', 'RUT', 'DJX', 'OEX', 'XSP']);

function chainUrl(symbol: string): string {
  const file = INDEX_ROOTS.has(symbol) ? `_${symbol}` : symbol;
  return `${CDN}/${encodeURIComponent(file)}.json`;
}

/**
 * One contract exactly as the CDN publishes it.
 *
 * Exported because the scanner's option-quality gate needs `bid`, `ask` and
 * `volume`, none of which survive into `NormalisedContract` — that shape is
 * built for the exposure maths, which only ever needed open interest and a
 * vol. See `scanner/optionChain.ts`.
 */
export interface CboeContract {
  option?: string;
  bid?: number;
  ask?: number;
  iv?: number;
  open_interest?: number;
  volume?: number;
  gamma?: number;
  last_trade_price?: number;
  prev_day_close?: number;
  theo?: number;
}

interface CboePayload {
  timestamp?: string;
  data?: {
    symbol?: string;
    current_price?: number;
    close?: number;
    prev_day_close?: number;
    options?: CboeContract[];
  };
}

/**
 * OCC option symbol: root, then YYMMDD, then C/P, then the strike in
 * thousandths. `SPY260807C00500000` is a SPY 7 Aug 2026 500 call.
 */
const OCC = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

interface ParsedSymbol {
  expiration: string;
  type: OptionType;
  strike: number;
}

export function parseOccSymbol(symbol: string): ParsedSymbol | null {
  const m = OCC.exec(symbol);
  if (!m) return null;
  return {
    expiration: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5] === 'C' ? 'call' : 'put',
    strike: Number(m[6]) / 1000,
  };
}

/** Best available price for backing out an implied vol. */
function usablePrice(c: CboeContract): number | null {
  const { bid, ask } = c;
  if (typeof bid === 'number' && typeof ask === 'number' && bid > 0 && ask > bid) {
    return (bid + ask) / 2;
  }
  if (typeof c.theo === 'number' && c.theo > 0) return c.theo;
  if (typeof c.last_trade_price === 'number' && c.last_trade_price > 0) {
    return c.last_trade_price;
  }
  if (typeof c.prev_day_close === 'number' && c.prev_day_close > 0) {
    return c.prev_day_close;
  }
  return null;
}

/**
 * The payload's top-level `timestamp` is `YYYY-MM-DD HH:MM:SS` in **UTC**, with
 * no offset or zone marker to say so.
 *
 * Verified against two samples taken hours apart: `2026-08-07 00:46:27` while
 * New York was at 20:46 on 6 Aug, and `2026-08-07 19:21:16` while New York was
 * at 15:21. Both match UTC exactly.
 *
 * Note that Cboe is not internally consistent here — the per-contract
 * `last_trade_time` field IS New York time. Only this top-level stamp is UTC.
 * Reading it as market time puts the "data as of" label four or five hours into
 * the future, which makes live data look stale.
 */
function parseTimestamp(raw: string | undefined): Date {
  if (!raw) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(raw.trim());
  if (!m) return new Date();
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
}

/** The CDN payload, validated but not yet interpreted. */
export interface CboeRaw {
  symbol: string;
  spot: number;
  quoteDate: Date;
  contracts: CboeContract[];
}

/**
 * Fetch and validate one chain, stopping short of any interpretation.
 *
 * Split out of `fetchCboeSnapshot` so the scanner's contract check can read
 * bid/ask off the same payload without going through the IV surface and the
 * strike-window trim, neither of which it wants: it is looking for one call
 * 30-60 days out, not a table of dealer exposure. Same URL, same headers, same
 * error contract — one place for all of that to be wrong.
 */
export async function fetchCboeRaw(symbolOverride?: string): Promise<CboeRaw> {
  const symbol = symbolOverride ?? config.symbol;

  let response: Response;
  try {
    response = await fetch(chainUrl(symbol), {
      headers: {
        // The CDN rejects the default Node user-agent outright. This is the
        // same public data the Cboe website itself loads in a browser.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://www.cboe.com/',
      },
      // Deliberately `next.revalidate` rather than `cache: 'no-store'`:
      // no-store would opt the whole `/` route out of static rendering and
      // cost a serverless invocation on every visit. The raw payload is
      // several megabytes, past the Next.js Data Cache entry limit, so Next
      // will decline to store it and log a notice — that is fine, because the
      // parsed result is cached in-process by `cached()` in positioning.ts,
      // and the page itself is regenerated on the same interval by ISR.
      next: { revalidate: config.cacheSeconds },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    throw new ChainError(
      'Could not reach the Cboe delayed-quote service.',
      0,
      cause instanceof Error ? cause.message : undefined,
    );
  }

  if (response.status === 403 || response.status === 404) {
    throw new ChainError(
      `Cboe returned HTTP ${response.status} for ${symbol}.`,
      response.status,
      'The symbol may not be published, or the CDN is refusing this client.',
    );
  }
  if (!response.ok) {
    throw new ChainError(`Cboe returned HTTP ${response.status}.`, response.status);
  }

  const payload = (await response.json()) as CboePayload;
  const data = payload.data;

  const spot = data?.current_price || data?.close || data?.prev_day_close;
  if (!spot || !Number.isFinite(spot) || spot <= 0) {
    throw new ChainError(`Cboe returned no underlying price for ${symbol}.`, 200);
  }

  const raw = data?.options ?? [];
  if (raw.length === 0) {
    throw new ChainError(`Cboe returned no ${symbol} option contracts.`, 200);
  }

  return { symbol, spot, quoteDate: parseTimestamp(payload.timestamp), contracts: raw };
}

export async function fetchCboeSnapshot(
  symbolOverride?: string,
): Promise<ChainSnapshot> {
  const notes: string[] = [];
  const { symbol, spot, quoteDate, contracts: raw } = await fetchCboeRaw(symbolOverride);

  const now = new Date();
  const quotes: RawQuote[] = [];
  let unparsed = 0;

  /*
   * Summed over every listed contract, before the window trim below and
   * before the zero-open-interest skip — these totals describe the whole
   * book, which is what the tradeability cutoffs are calibrated against.
   * Carried on the snapshot so a caller needing both exposure and liquidity
   * spends one chain request rather than two.
   */
  let chainVolume = 0;
  let chainOpenInterest = 0;

  for (const c of raw) {
    const contractVolume = Number(c.volume ?? 0);
    if (Number.isFinite(contractVolume) && contractVolume > 0) {
      chainVolume += contractVolume;
    }
    const contractOi = Number(c.open_interest ?? 0);
    if (Number.isFinite(contractOi) && contractOi > 0) chainOpenInterest += contractOi;

    if (!c.option) continue;
    const parsed = parseOccSymbol(c.option);
    if (!parsed) {
      unparsed += 1;
      continue;
    }

    const openInterest = Number(c.open_interest ?? 0);
    if (!Number.isFinite(openInterest) || openInterest <= 0) continue;

    quotes.push({
      ticker: c.option,
      type: parsed.type,
      strike: parsed.strike,
      expiration: parsed.expiration,
      openInterest,
      quotedIv: typeof c.iv === 'number' && c.iv > 0 ? c.iv : null,
      price: usablePrice(c),
    });
  }

  if (unparsed > 0) {
    notes.push(`${unparsed} contracts had an unrecognised symbol format and were skipped.`);
  }
  if (quotes.length === 0) {
    throw new ChainError(
      `No ${symbol} contracts with open interest.`,
      200,
      'Every contract returned had zero open interest.',
    );
  }

  const windowed = trimToWindow(quotes, {
    spot,
    // Trim to the widest expiration set any consumer needs, so the dashboard
    // and the forecast can be built from one fetch.
    expirationCount: config.maxExpirations,
    strikesEachSide: config.strikesEachSide,
    now,
  });

  const contracts = resolveIvSurface(windowed, {
    spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    now,
  });

  if (contracts.length === 0) {
    throw new ChainError(`No usable ${symbol} contracts after filtering.`, 200);
  }

  return {
    spot,
    quoteDate,
    contracts,
    requests: 1,
    activity: { volume: chainVolume, openInterest: chainOpenInterest },
    notes,
  };
}
