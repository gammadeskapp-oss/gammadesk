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

/** One bar. Times are epoch seconds, which is what lightweight-charts wants. */
export interface ChartBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
