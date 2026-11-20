import type { Liquidity } from '../ticker/types';

/**
 * Whether the exposure tables (and the GEX figures on the walls) may be shown,
 * and when not, *why not* — because the two reasons read completely
 * differently to the person looking at the page.
 *
 * "This chain is too thin to trust" is a claim about the market. "The data has
 * not arrived" is a claim about this site's plumbing. Printing the first when
 * the second is true told a reader that SPY — the deepest options chain listed
 * anywhere — had too little open interest to measure. So the gate keeps them
 * apart:
 *
 * - `thin` only after a complete read that genuinely came back under the floor,
 *   on a product that is not known to be deep.
 * - `feed` when the book is still loading, the stream is reconnecting, or a
 *   known-liquid product came back "thin" (which is a data failure by
 *   definition, not a reading).
 * - A lookup that could not be read at all is not evidence of anything, and
 *   never suppresses.
 *
 * Pure, so `scripts/verify-exposure-gate.mjs` can test every branch.
 */

/**
 * Products whose chains are never thin. A "not enough open interest" verdict on
 * one of these is a broken read, so it is reported as one. Index options, the
 * major index and macro ETFs, and the handful of single names whose chains sit
 * in the millions of contracts.
 */
export const KNOWN_LIQUID_OPTIONS: ReadonlySet<string> = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'SPXW', 'XSP', 'NDX', 'RUT', 'VIX',
  'TLT', 'GLD', 'SLV', 'HYG', 'XLF', 'XLE', 'EEM', 'SMH',
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'AMD',
]);

export function isKnownLiquid(symbol: string | null | undefined): boolean {
  return !!symbol && KNOWN_LIQUID_OPTIONS.has(symbol.trim().toUpperCase());
}

/** Same floor as `config.tradeability.minOpenInterestForExposure`'s default. */
export const DEFAULT_MIN_OPEN_INTEREST = 10_000;

/** A book with fewer than this share of its contracts filled is incomplete. */
export const FEED_COMPLETE_RATIO = 0.9;

/** Matches the /lab stamp: older than this, during the session, is stale. */
export const FEED_STALE_MS = 20_000;

/** The live stream's state, as `/lab` sees it. Plain numbers only. */
export interface FeedHealth {
  /** Option contracts the book subscribed. */
  optionsExpected: number;
  /** Of those, how many have both an IV (Greeks) and open interest (Summary). */
  optionsComplete: number;
  /** Open interest summed over the contracts that reported one. */
  openInterest: number;
  /** Today's option volume summed over the same contracts. */
  volume: number;
  /** ms since the stream last delivered any market data; null if it never has. */
  dataAgeMs: number | null;
  /** True while the socket is down or re-handshaking. */
  reconnecting: boolean;
  /** True while subscriptions are queued behind dxLink's rate limit. */
  loading: boolean;
  /** Why the client last tore the socket down itself, if it has. */
  lastReconnectReason: string | null;
  /** True when the client re-requested missing open interest on this read. */
  rerequested: boolean;
}

export type ExposureGate =
  | { show: true; caveat: string | null }
  | { show: false; reason: 'thin' }
  | { show: false; reason: 'feed'; headline: string; detail: string };

export function exposureGate(input: {
  symbol: string | null;
  liquidity: Liquidity | null;
  /** Present on `/lab`, where the tables are built from the feed's own book. */
  feed?: FeedHealth | null;
  /** Staleness only counts during the session; off-hours a quiet feed is normal. */
  marketOpen?: boolean;
}): ExposureGate {
  const { symbol, liquidity, feed, marketOpen = false } = input;
  const known = isKnownLiquid(symbol);
  const floor = liquidity?.options.minOpenInterestForExposure ?? DEFAULT_MIN_OPEN_INTEREST;

  if (feed) {
    const stalled = marketOpen && feed.dataAgeMs !== null && feed.dataAgeMs > FEED_STALE_MS;
    const complete =
      feed.optionsExpected > 0 && feed.optionsComplete >= feed.optionsExpected * FEED_COMPLETE_RATIO;

    if (!complete) {
      const progress = `Open interest has arrived for ${feed.optionsComplete.toLocaleString('en-US')} of ${feed.optionsExpected.toLocaleString('en-US')} contracts.`;
      return {
        show: false,
        reason: 'feed',
        headline:
          feed.reconnecting || stalled
            ? 'Waiting for the feed — reconnecting.'
            : 'Waiting for the feed — open interest still loading.',
        detail: `${progress} ${
          feed.loading
            ? 'dxLink limits how fast symbols can be added, so the rest is queued.'
            : feed.rerequested
              ? 'The missing contracts were re-requested from the stream.'
              : 'The stream is being asked for the rest.'
        } A partial book draws the wrong levels, so the tables wait for it rather than showing one. This is the data still arriving, not a verdict on the chain.`,
      };
    }

    // The tables on /lab are the feed's book, so they are judged by its own open interest.
    if (feed.openInterest >= floor) {
      return {
        show: true,
        caveat: feed.reconnecting
          ? `Feed reconnecting${feed.lastReconnectReason ? ` (${feed.lastReconnectReason})` : ''} — these are the last figures received.`
          : stalled
            ? `Feed stale — no update from the stream for ${Math.round((feed.dataAgeMs ?? 0) / 1000)}s; reconnecting. These are the last figures received.`
            : null,
      };
    }

    if (known) {
      return {
        show: false,
        reason: 'feed',
        headline: 'Waiting for the feed — open interest came back incomplete.',
        detail: `The stream reports only ${Math.round(feed.openInterest).toLocaleString('en-US')} contracts of open interest on ${symbol}, whose chain holds millions. That is a feed failure, not a reading, so it is re-requested rather than shown.`,
      };
    }
    return { show: false, reason: 'thin' };
  }

  if (liquidity === null) return { show: true, caveat: null };
  const options = liquidity.options;
  // A lookup that failed says nothing about the chain.
  if (options.status === 'unread') return { show: true, caveat: null };
  if (options.exposureReliable) return { show: true, caveat: null };
  if (known) {
    return {
      show: true,
      caveat: `The tradeability lookup reported thin open interest on ${symbol}, which is never true of this chain, so it is treated as a failed read and ignored.`,
    };
  }
  return { show: false, reason: 'thin' };
}
