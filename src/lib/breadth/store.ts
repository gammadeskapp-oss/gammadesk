import 'server-only';

import { createJsonStore } from '../jsonStore';
import { marketToday } from '../time';
import type { BreadthSample, EqualWeightSpread } from './types';
import type { BreadthSource } from './universe';

export { storeStatus } from '../jsonStore';

/**
 * The intraday breadth series, kept in Vercel Blob beside the Accuracy Log.
 *
 * A single reading says how many stocks are up right now. The series says
 * whether that has been improving or decaying through the session, which is
 * the part a snapshot cannot show — 45% on the way up from 20% and 45% on the
 * way down from 70% are the same number and not the same day.
 *
 * One document per session. It is replaced, not appended to, when the New York
 * date changes: yesterday's participation is not context for today, and an
 * unbounded document would eventually be too large to rewrite inside a
 * function timeout.
 */

const SCHEMA = 1;

export interface BreadthDoc {
  schema: number;
  /** New York session date these samples belong to, `YYYY-MM-DD`. */
  date: string;
  /** Oldest first. */
  samples: BreadthSample[];
  /** Which price feed produced the newest sample. */
  source: BreadthSource | null;
  /** Latest Method B reading. Only the newest is kept; it is a cross-check on
   *  the current sample, not a series in its own right. */
  spread: EqualWeightSpread | null;
  updatedAt: string;
}

/**
 * Samples kept for one session.
 *
 * A minute apart across six and a half hours is 390. The cap is a little above
 * that so a day with manual re-runs cannot grow without bound, and old samples
 * fall off the front rather than the back — the recent shape is what the
 * sparkline draws.
 */
export const MAX_SAMPLES = 420;

function empty(): BreadthDoc {
  return {
    schema: SCHEMA,
    date: marketToday(),
    samples: [],
    source: null,
    spread: null,
    updatedAt: new Date().toISOString(),
  };
}

const store = createJsonStore<BreadthDoc>(
  'gammadesk/breadth.json',
  empty,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as BreadthDoc;
    if (doc.schema !== SCHEMA || typeof doc.date !== 'string') return null;
    if (!Array.isArray(doc.samples)) return null;
    return doc;
  },
);

/**
 * Today's document, or an empty one.
 *
 * A stored document from an earlier session is discarded on read rather than
 * being returned and filtered by every caller. That keeps "the series" and
 * "the series for today" from being two different things anywhere else.
 */
export async function readBreadthDoc(now: Date = new Date()): Promise<BreadthDoc> {
  const doc = await store.read();
  return doc.date === marketToday(now) ? doc : empty();
}

/** Append one sample and refresh the cross-check, rolling the day if needed. */
export async function appendSample(
  sample: BreadthSample | null,
  spread: EqualWeightSpread | null,
  source: BreadthSource | null,
  now: Date = new Date(),
): Promise<BreadthDoc> {
  const today = marketToday(now);

  return store.update((current) => {
    const base: BreadthDoc =
      current.date === today ? current : { ...empty(), date: today };

    const samples = sample ? [...base.samples, sample] : base.samples;

    return {
      ...base,
      samples: samples.slice(-MAX_SAMPLES),
      source: sample ? source : base.source,
      // A failed Method B leaves the previous cross-check in place rather than
      // blanking it. One timed-out request is not evidence the spread changed.
      spread: spread ?? base.spread,
      updatedAt: now.toISOString(),
    };
  });
}

/**
 * The price ring — a separate document, on purpose.
 *
 * The fifteen-minute reading ("how many companies are higher than they were a
 * quarter of an hour ago") needs a price per symbol from fifteen minutes ago.
 * Neither batch source provides that: the Tradier quote is a snapshot, and the
 * Yahoo fallback's bar series only exists on the fallback path. So the refresh
 * remembers its own prices and compares against them.
 *
 * Five hundred prices is a few kilobytes, and it is read by nothing except the
 * refresh itself. Keeping it out of `breadth.json` means the document every
 * page render reads stays small — the series a card draws should not carry
 * five hundred prices per minute with it.
 */

export interface PriceSnapshot {
  at: string;
  /** Symbol to latest price. */
  prices: Record<string, number>;
}

interface PriceRingDoc {
  schema: number;
  date: string;
  /** Oldest first. */
  snapshots: PriceSnapshot[];
}

/**
 * Snapshots kept, and how far apart they are taken.
 *
 * The refresh runs every minute, but the ring does not need a snapshot per
 * minute: the only question asked of it is "what was this trading at about a
 * quarter of an hour ago". Five hundred prices is roughly eleven kilobytes, so
 * a snapshot a minute would rewrite a hundred and eighty kilobyte document
 * three hundred and ninety times a session for no extra precision.
 *
 * At five-minute spacing, five snapshots span twenty minutes — always enough
 * to hold one that is at least fifteen minutes old — and the document is
 * rewritten a twelfth as often. The exact age used is reported rather than
 * assumed, so the comparison never claims to be finer than it is.
 */
const RING_SIZE = 5;
const RING_SPACING_MINUTES = 5;

const priceStore = createJsonStore<PriceRingDoc>(
  'gammadesk/breadth-prices.json',
  () => ({ schema: SCHEMA, date: marketToday(), snapshots: [] }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as PriceRingDoc;
    if (doc.schema !== SCHEMA || !Array.isArray(doc.snapshots)) return null;
    return doc;
  },
);

/**
 * Prices from roughly `minutes` ago, and how long ago that actually was.
 *
 * Takes the newest snapshot that is at least `minutes` old, so the comparison
 * is never over a shorter span than advertised. When the session is younger
 * than the look-back there is nothing to compare against and the caller
 * reports no reading rather than one over a shorter window.
 */
export async function readPriorPrices(
  minutes: number,
  now: Date = new Date(),
): Promise<{ prices: Map<string, number>; ageMinutes: number | null }> {
  const doc = await priceStore.read();
  if (doc.date !== marketToday(now)) return { prices: new Map(), ageMinutes: null };

  const cutoff = now.getTime() - minutes * 60_000;
  let chosen: PriceSnapshot | null = null;
  for (const snapshot of doc.snapshots) {
    if (Date.parse(snapshot.at) <= cutoff) chosen = snapshot;
  }

  if (!chosen) return { prices: new Map(), ageMinutes: null };

  return {
    prices: new Map(Object.entries(chosen.prices)),
    ageMinutes: Math.round((now.getTime() - Date.parse(chosen.at)) / 60_000),
  };
}

/** Push this refresh's prices onto the ring, rolling the day if needed. */
export async function appendPrices(
  prices: Map<string, number>,
  now: Date = new Date(),
): Promise<void> {
  if (prices.size === 0) return;
  const today = marketToday(now);

  const current = await priceStore.read();
  const snapshots = current.date === today ? current.snapshots : [];

  // Not yet due. Skipped without a write at all — this is the large document,
  // and rewriting it unchanged eleven times out of twelve is the cost this
  // spacing exists to avoid.
  const newest = snapshots[snapshots.length - 1];
  if (newest && now.getTime() - Date.parse(newest.at) < RING_SPACING_MINUTES * 60_000) {
    return;
  }

  await priceStore.write({
    schema: SCHEMA,
    date: today,
    snapshots: [
      ...snapshots,
      { at: now.toISOString(), prices: Object.fromEntries(prices) },
    ].slice(-RING_SIZE),
  });
}
