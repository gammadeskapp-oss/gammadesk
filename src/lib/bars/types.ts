/**
 * Shared by the chart component and the route that feeds it.
 *
 * Deliberately free of `server-only` and of any import that pulls it in:
 * `intraday.ts` is server-side, and the browser still needs to know which
 * timeframes exist to render the buttons.
 */

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export function isTimeframe(value: string | null | undefined): value is Timeframe {
  return !!value && (TIMEFRAMES as readonly string[]).includes(value);
}

/** The default timeframe a reader who has never chosen one lands on. */
export const DEFAULT_TIMEFRAME: Timeframe = '15m';

/**
 * The timeframe to open on, given whatever was persisted.
 *
 * The precedence is the whole point: a valid stored choice is honoured, and the
 * default is applied only when there is nothing usable to honour — so a reader
 * who once picked 5m keeps it, and one who has never chosen lands on the
 * default rather than on whatever the last-written value happened to be. Kept a
 * pure function, separate from the `localStorage` read, so that precedence can
 * be pinned by the verify script without a DOM.
 */
export function resolveTimeframe(
  stored: string | null | undefined,
  fallback: Timeframe = DEFAULT_TIMEFRAME,
): Timeframe {
  return isTimeframe(stored) ? stored : fallback;
}

/** One bar. Times are epoch seconds, which is what lightweight-charts wants. */
export interface ChartBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
