import 'server-only';

import { fetchTradierQuotes, tradierToken } from '../breadth/tradier';
import { marketStatus } from '../marketPhase';
import { formatClockEt } from '../time';
import { noOverlay, type LiveOverlay } from './types';

export { noOverlay } from './types';
export type { LiveOverlay, LiveQuote, PriceSource } from './types';

/**
 * Live prices for the private pages, when this machine is allowed to have any.
 *
 * ## The rule, and where it is enforced
 *
 * Tradier's terms make serving their data to visitors redistribution, so the
 * production deploy never carries `TRADIER_TOKEN`. That is the rule working,
 * not a misconfiguration — see `lib/movers/types.ts`, which has said so since
 * the movers list learned the same trick.
 *
 * This module is the single place that decides. Every caller gets a
 * `LiveOverlay` and never an exception: absent token, closed market, a feed
 * that timed out and a symbol the feed does not know all come back as an
 * overlay that says what happened. A caller cannot accidentally hard-depend on
 * live prices, because there is no shape in which this function fails loudly.
 *
 * Callers must still not be public pages. The gate here is necessary and it is
 * not sufficient: a public page wired to this would serve stored numbers in
 * production and live ones on a developer's screen, which is a page that
 * behaves differently in the only environment nobody checks.
 *
 * ## It never writes anything
 *
 * No store, no cache document, no blob. A live price that got persisted would
 * outlive the process that read it and could be served from a stored document
 * later — which is the same redistribution the token rule exists to prevent,
 * arriving by a slower route. Overlays are computed per request, applied at
 * read time, and discarded.
 */

/**
 * How many symbols one sweep will ask for.
 *
 * The batch endpoint took the whole 485-symbol universe in 132 ms when it was
 * measured, so this is not a chunking workaround — it is a ceiling, so a caller
 * that grows its universe cannot turn one page view into an unbounded request.
 */
const MAX_SYMBOLS = 600;

const TIMEOUT_MS = 8_000;

export interface LiveOptions {
  /**
   * Return an overlay outside a session too.
   *
   * The default is to fetch anyway and let the label change: the last print is
   * a real price and it is fresher than a stored close from the RS digest,
   * which can be a day behind. What must not happen is calling it "live", and
   * `LiveOverlay.marketOpen` is what stops that.
   */
  now?: Date;
}

export async function getLiveOverlay(
  symbols: string[],
  options: LiveOptions = {},
): Promise<LiveOverlay> {
  if (!tradierToken()) {
    return noOverlay(
      'TRADIER_TOKEN is not set, so prices come from stored daily closes. This is the only behaviour production has.',
    );
  }

  const wanted = Array.from(new Set(symbols.filter(Boolean))).slice(0, MAX_SYMBOLS);
  if (wanted.length === 0) {
    return noOverlay('No symbols were asked for.');
  }

  const now = options.now ?? new Date();
  const status = marketStatus(now);

  try {
    const { quotes, unmatched } = await fetchTradierQuotes(wanted, TIMEOUT_MS);

    if (quotes.size === 0) {
      return noOverlay(
        'The quote feed answered with no usable prices, so stored closes are shown instead.',
      );
    }

    const map: LiveOverlay['quotes'] = {};
    for (const [symbol, quote] of quotes) {
      map[symbol] = { symbol, last: quote.last, prevClose: quote.prevClose };
    }

    return {
      available: true,
      quotes: map,
      capturedAt: now.toISOString(),
      capturedEt: formatClockEt(now),
      reason: null,
      marketOpen: status.open,
      unmatched,
    };
  } catch (error) {
    /*
     * A failed sweep is a missing overlay and never a failed page. Every
     * caller already renders stored closes correctly — that is the production
     * path — so the fallback here is the normal path rather than a degraded
     * one, and it is worth naming as such on screen.
     */
    return noOverlay(
      `The quote feed could not be read (${
        error instanceof Error ? error.message : String(error)
      }), so stored closes are shown instead.`,
    );
  }
}
