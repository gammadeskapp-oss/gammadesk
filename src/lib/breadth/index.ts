import 'server-only';

import { cached } from '../cache';
import { marketNow } from '../time';
import { breadthBand, GREEN_LOOKBACK_MINUTES, type BreadthBand } from './compute';
import { fetchEqualWeightSpread } from './spread';
import {
  appendPrices,
  appendSample,
  readBreadthDoc,
  readPriorPrices,
} from './store';
import type { BreadthReading, BreadthSample } from './types';
import { sweepConstituents, type BreadthSource } from './universe';

export { breadthBand, FLAT_BAND_PCT, GREEN_LOOKBACK_MINUTES } from './compute';
export type { BreadthBand } from './compute';
export { storeStatus } from './store';
export type * from './types';

/**
 * The breadth meter: one refresh, and one read.
 *
 * Pages call `getBreadth`, which only reads storage. The upstream sweep
 * happens in the cron route, so a page view never spends five hundred symbols
 * worth of requests and a burst of viewers cannot multiply that.
 */

/** Regular trading hours, New York, in minutes past midnight. */
const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;

/**
 * Whether the market is open, on the New York clock.
 *
 * The breadth refresh runs every minute rather than at one fixed time, so the
 * dual-UTC-registration trick the fixed-time jobs use does not apply to it —
 * there is no single clock time to land on. The same underlying rule does: the
 * cron entry covers a UTC span wide enough to contain the session under either
 * offset, and this guard decides, on the New York wall clock, which of those
 * firings are actually inside the session. Everything outside returns without
 * spending a request.
 *
 * Holidays are not detected here. A holiday sweep finds every constituent
 * still showing yesterday's close, so it produces a reading of exactly 0%
 * advancers — which is why `refreshBreadth` checks the sample for that shape
 * rather than trusting the calendar.
 */
export function isRegularHours(now: Date = new Date()): boolean {
  const clock = marketNow(now);
  if (clock.weekday === 0 || clock.weekday === 6) return false;
  const minutes = clock.hour * 60 + clock.minute;
  return minutes >= RTH_OPEN && minutes <= RTH_CLOSE;
}

export interface RefreshResult {
  stored: boolean;
  sample: BreadthSample | null;
  source: BreadthSource | null;
  universe: number;
  measured: number;
  requests: number;
  notes: string[];
}

/**
 * One refresh: the constituent sweep and the two-symbol cross-check, in
 * parallel, then one write.
 *
 * Method B runs even when Method A fails. It is one request and it is the only
 * reading available on a session where the sweep is degraded.
 */
export async function refreshBreadth(now: Date = new Date()): Promise<RefreshResult> {
  // What the universe was trading at a quarter of an hour ago, from this
  // project's own earlier snapshot — see `store.ts`.
  const prior = await readPriorPrices(GREEN_LOOKBACK_MINUTES, now);

  const [sweep, spread] = await Promise.all([
    sweepConstituents(now, prior.prices),
    fetchEqualWeightSpread().catch(() => null),
  ]);

  const notes = [...sweep.notes];
  let sample = sweep.sample;

  /*
   * The market-holiday shape.
   *
   * On a closed day the feed answers normally and every constituent's latest
   * price is its previous close, so nothing is above and nothing is below.
   * That renders as a genuine-looking 0% — the most alarming number the card
   * can show — from a day on which nothing happened. Refused rather than
   * stored.
   */
  if (sample && sample.counts.measured > 0 && sample.counts.unchanged === sample.counts.measured) {
    notes.push(
      'Every company is showing yesterday’s closing price, so the market is almost certainly closed. No sample was stored.',
    );
    sample = null;
  }

  if (spread === null) {
    notes.push('The RSP-against-SPY cross-check could not be read this refresh.');
  }

  const doc = await appendSample(sample, spread, sweep.source, now);

  /*
   * The price ring is written even when the sample was refused. A holiday or a
   * thin sweep is still the truth about what those prices were, and dropping
   * it would leave the next refresh with no fifteen-minute baseline.
   */
  await appendPrices(sweep.prices, now);

  return {
    stored: sample !== null || spread !== null,
    sample,
    source: sweep.source,
    universe: sweep.universe,
    measured: sample?.counts.measured ?? 0,
    requests: sweep.requests + (spread ? 1 : 0),
    notes: [...notes, ...(doc.samples.length === 0 ? ['No samples stored yet today.'] : [])],
  };
}

/**
 * What the pages render.
 *
 * Cached briefly so the decision page, the scanner page and anything else
 * reading breadth in the same render share one store read. The refresh writes
 * at most once a minute, so a short reuse cannot show anything the viewer
 * could otherwise have seen.
 */
export function getBreadth(): Promise<BreadthReading> {
  return cached('breadth:reading', 30, async () => {
    const doc = await readBreadthDoc();
    const latest = doc.samples[doc.samples.length - 1] ?? null;

    const notes: string[] = [];
    if (!latest && !doc.spread) {
      notes.push(
        'No breadth reading has been taken yet today. The refresh runs every minute while the market is open.',
      );
    }

    return {
      computed: latest,
      source: doc.source,
      spread: doc.spread,
      series: doc.samples,
      notes,
    } satisfies BreadthReading;
  });
}

/**
 * The breadth percentage as of a given moment, for stamping an event with the
 * reading that was current when it fired.
 *
 * Takes the newest sample at or before the instant — never a later one. An
 * event at 09:52 stamped with the 10:30 reading would be a quiet lie about
 * what was known at the time.
 */
export function breadthAt(
  samples: BreadthSample[],
  at: Date,
): { pct: number; band: BreadthBand } | null {
  const ms = at.getTime();
  let best: BreadthSample | null = null;

  for (const sample of samples) {
    if (Date.parse(sample.at) > ms) break;
    best = sample;
  }

  if (!best) return null;
  return { pct: best.pctAbovePriorClose, band: breadthBand(best.pctAbovePriorClose) };
}
