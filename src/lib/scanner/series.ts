/**
 * The bar shape the scanner and its chart share.
 *
 * Client-safe, for the same reason as `nadarayaWatson.ts`: the reading and the
 * picture beside it have to be drawn from the same numbers.
 *
 * This file used to hold the anchored VWAP as well. That went with the filter
 * it existed for — see `FILTER_KEYS` in `types.ts` — and is not kept around
 * unused: a helper nothing calls is a filter waiting to be quietly reinstated.
 * /decision has its own VWAP, on a live chart where it means something.
 */

/** One bar, as `/api/bars` serves it. Times are epoch seconds. */
export interface SeriesBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Last non-null value of a series. */
export function lastDefined(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] !== null) return series[i];
  }
  return null;
}
