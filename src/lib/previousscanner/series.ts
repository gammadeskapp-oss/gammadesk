/**
 * Anchored VWAP, and the bar shape the scanner and the chart share.
 *
 * Client-safe, for the same reason as `nadarayaWatson.ts`: the row and the
 * picture beside it have to be drawing the same line.
 */

import type { VwapAnchor } from './types';

/** One bar, as `/api/bars` serves it. Times are epoch seconds. */
export interface SeriesBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * New York calendar date per bar, from one reused formatter.
 *
 * Constructing an `Intl.DateTimeFormat` per bar is the slow way to do this and
 * shows up immediately on a multi-thousand-bar series.
 */
const nyDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Monday of the week containing `iso`, as `YYYY-MM-DD`. */
function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = Date.UTC(y, m - 1, d);
  // getUTCDay: 0 = Sunday. Sunday belongs to the week that began six days ago,
  // not to the one starting tomorrow.
  const offset = (new Date(at).getUTCDay() + 6) % 7;
  return new Date(at - offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Which bucket a bar's VWAP accumulates into.
 *
 * A session anchor is the right one on an hourly series and meaningless on a
 * daily one — every daily bar is its own session, so a session-anchored daily
 * VWAP is just the bar's own typical price and comparing the close to it is a
 * coin toss. That is why the anchor is per timeframe and stated in the UI
 * rather than being a fixed assumption buried here.
 */
function bucketOf(bar: SeriesBar, anchor: VwapAnchor): string {
  const date = nyDate.format(new Date(bar.t * 1000));
  return anchor === 'session' ? date : weekStart(date);
}

/**
 * Anchored VWAP aligned index-for-index with `bars`.
 *
 * `null` where the accumulated volume is zero — some ETFs report no volume on
 * some bars, and VWAP there is undefined rather than zero.
 */
export function anchoredVwap(bars: SeriesBar[], anchor: VwapAnchor): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);

  let bucket = '';
  let pv = 0;
  let volume = 0;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const here = bucketOf(bar, anchor);
    if (here !== bucket) {
      bucket = here;
      pv = 0;
      volume = 0;
    }

    const typical = (bar.h + bar.l + bar.c) / 3;
    pv += typical * bar.v;
    volume += bar.v;

    out[i] = volume > 0 ? pv / volume : null;
  }

  return out;
}

/** Last non-null value of a series. */
export function lastDefined(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] !== null) return series[i];
  }
  return null;
}
