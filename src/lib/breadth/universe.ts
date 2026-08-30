import 'server-only';

import { getMembership } from '../rs/membership';
import { formatEtClock } from '../scanner/schedule';
import { computeSample, type SymbolSession } from './compute';
import { fetchSparks, yahooSymbol } from './spark';
import { fetchTradierQuotes, tradierToken } from './tradier';
import type { BreadthSample } from './types';

/**
 * Method A — breadth counted from the S&P 500 constituents themselves.
 *
 * The relative-strength engine already keeps index membership current and
 * stored (`rs/membership.ts`), so this reuses that list rather than keeping a
 * second one that could drift out of agreement with it.
 *
 * ## Two sources, in order
 *
 * 1. **Tradier batch quotes** — the whole universe in one request, about a
 *    tenth of a second. This is what makes a once-a-minute refresh cheap.
 * 2. **Yahoo spark** — twenty symbols per request, twenty-five requests, about
 *    two seconds. Used when there is no Tradier token or the request fails.
 *
 * The fallback is not merely a spare: it carries an intraday price series,
 * which the quote snapshot does not, so the "above its own average price for
 * the day" reading is only available on that path. Which source produced a
 * sample is reported, because the two do not answer identically.
 */

export type BreadthSource = 'tradier' | 'yahoo';

/**
 * Fewest constituents that must answer before a sample is produced at all.
 *
 * The failure this guards against is the one that does not throw: a degraded
 * sweep returning forty names still computes a confident-looking percentage,
 * and forty companies are not the S&P 500. Same reasoning as the plausibility
 * check in `membership.ts`, applied to the sweep rather than to the list.
 */
export const MIN_MEASURED = 300;

export interface SweepResult {
  sample: BreadthSample | null;
  source: BreadthSource | null;
  /** Symbols in the universe this run tried to read. */
  universe: number;
  /** Latest price per symbol, for the next refresh's fifteen-minute reading. */
  prices: Map<string, number>;
  requests: number;
  notes: string[];
}

async function viaTradier(symbols: string[]): Promise<SymbolSession[]> {
  const { quotes } = await fetchTradierQuotes(symbols);
  return [...quotes.values()].map((q) => ({
    symbol: q.symbol,
    last: q.last,
    previousClose: q.prevClose,
  }));
}

async function viaYahoo(
  symbols: string[],
): Promise<{ sessions: SymbolSession[]; requests: number; failedChunks: number }> {
  const { series, requests, failedChunks } = await fetchSparks(symbols, {
    // Five minutes is the finest spacing that reliably spans a whole session
    // in one spark response.
    interval: '5m',
    timeoutMs: 25_000,
  });

  const sessions: SymbolSession[] = [];
  for (const [symbol, s] of series) {
    sessions.push({
      symbol,
      last: s.closes[s.closes.length - 1],
      previousClose: s.previousClose,
      closes: s.closes,
    });
  }

  return { sessions, requests, failedChunks };
}

export async function sweepConstituents(
  now: Date = new Date(),
  priorPrices: Map<string, number> = new Map(),
): Promise<SweepResult> {
  const notes: string[] = [];

  const membership = await getMembership();
  const symbols = membership.members.map((m) => m.symbol);

  if (membership.source === 'seed') {
    notes.push(
      'Index membership is the checked-in fallback list, not a fetched one. A recent addition or removal may be missing.',
    );
  }

  let sessions: SymbolSession[] = [];
  let source: BreadthSource | null = null;
  let requests = 0;

  if (tradierToken()) {
    try {
      sessions = await viaTradier(symbols);
      source = 'tradier';
      requests = 1;
    } catch (error) {
      notes.push(
        `The batch quote request failed (${error instanceof Error ? error.message : 'unknown error'}), so the slower backup source was used.`,
      );
    }
  }

  if (source === null) {
    // Yahoo writes class shares with a dash; the stored list uses a dot. The
    // spark client maps on the way out, so the sessions come back under the
    // spelling that went in and the price map stays keyed consistently.
    const fallback = await viaYahoo(symbols);
    sessions = fallback.sessions;
    source = 'yahoo';
    requests = fallback.requests;
    if (fallback.failedChunks > 0) {
      notes.push(
        `${fallback.failedChunks} batch${fallback.failedChunks === 1 ? '' : 'es'} of quotes failed on the backup source.`,
      );
    }
  }

  const prices = new Map<string, number>();
  for (const s of sessions) prices.set(s.symbol, s.last);

  const sample = computeSample(sessions, now, formatEtClock(now), priorPrices);

  if (sample.counts.measured < MIN_MEASURED) {
    notes.push(
      `Only ${sample.counts.measured} of ${symbols.length} companies answered, which is too few to describe the whole index. No reading was stored.`,
    );
    return { sample: null, source, universe: symbols.length, prices, requests, notes };
  }

  const missing = symbols.length - sample.counts.measured;
  if (missing > 0) {
    notes.push(
      `${sample.counts.measured} of ${symbols.length} companies were priced. The other ${missing} are names the price feed does not carry, usually because they have been taken over or have left the index.`,
    );
  }

  return { sample, source, universe: symbols.length, prices, requests, notes };
}

/** Exported for the fallback path's symbol spelling, and for tests. */
export { yahooSymbol };
