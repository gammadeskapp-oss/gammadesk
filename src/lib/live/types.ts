/**
 * The shape of a live-price overlay, and the vocabulary for saying which
 * clock a number is on.
 *
 * Client-safe: the tables that render these labels are client components, and
 * a second hand-written copy of the wording would eventually describe a
 * different arrangement from the one the server actually applied.
 *
 * ## Two clocks is the whole problem this type exists to make visible
 *
 * A live quote and a stored level are not two versions of the same number,
 * they are two different measurements taken at two different times. A price
 * read a second ago, held up against a gamma flip level computed from this
 * morning's option chain, produces a distance that is neither this morning's
 * nor now's. It is still worth looking at — that is why the overlay exists —
 * but only if the page never lets the reader forget which half moved.
 *
 * So every number this project derives from a live quote carries a
 * `PriceSource`, every page that mixes the two prints the mixture in words,
 * and nothing anywhere renders a live figure and a stored figure in the same
 * column without saying so.
 */

/**
 * Where the price behind a reading came from.
 *
 * `stored` — the daily close this project already had, from its own bar
 * history. Delayed by construction, consistent with every other stored number,
 * and the only thing production ever produces.
 *
 * `live` — a quote read from Tradier moments ago. **Local only.** Serving
 * their data to visitors is redistribution under their terms, so the
 * production deploy must never carry `TRADIER_TOKEN` and no code path may
 * assume it exists.
 */
export type PriceSource = 'stored' | 'live';

/** One symbol's live reading. */
export interface LiveQuote {
  symbol: string;
  /** Latest traded price. */
  last: number;
  /** The previous session's close, as the feed reports it. */
  prevClose: number;
}

/**
 * The overlay as a whole, including the reasons it is not there.
 *
 * `available: false` is the normal state — it is what production always
 * returns and what a local machine returns outside a session or without a
 * token. `reason` is always populated when it is false, because "no live
 * prices" and "live prices failed" are different things and a page that
 * collapses them cannot tell a reader which.
 */
export interface LiveOverlay {
  available: boolean;
  /** Symbol to quote. Empty when `available` is false. */
  quotes: Record<string, LiveQuote>;
  /** ISO-8601 UTC instant the quotes were read. Null when unavailable. */
  capturedAt: string | null;
  /**
   * New York wall clock of the same instant, ready to print — `09:04 ET`.
   *
   * The suffix is part of the string, because `formatClockEt` is where the
   * whole app spells this and a second convention would eventually disagree
   * with the first. Callers render it as-is and must not append " ET".
   */
  capturedEt: string | null;
  /** Why there is no overlay, in plain English. Null when there is one. */
  reason: string | null;
  /**
   * Whether the market was open at capture.
   *
   * A quote read after the close is the closing print, not a live number, and
   * a page calling that "live" would be overstating it. The overlay is still
   * returned — the price is real — but the label changes.
   */
  marketOpen: boolean;
  /** Symbols the feed did not recognise, so a gap is attributable. */
  unmatched: string[];
}

/** The overlay that means "there is no overlay", with the reason attached. */
export function noOverlay(reason: string): LiveOverlay {
  return {
    available: false,
    quotes: {},
    capturedAt: null,
    capturedEt: null,
    reason,
    marketOpen: false,
    unmatched: [],
  };
}
