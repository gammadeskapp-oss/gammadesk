import 'server-only';

import type { ChartBar, Timeframe } from '../bars/types';
import { formatAsOf } from '../time';
import { CANDLE_SPEC, candleSymbolFor } from './candleBook';
import { tastySourceMode } from './mode';

/**
 * Live chart candles for `/lab`, off dxFeed's `Candle` event.
 *
 * The public chart reads `/api/bars` (15-minute delayed). On `/lab` with
 * `TASTY_SOURCE=live` the chart reads these instead, so the candles, the levels
 * drawn over them and the live price line are one source. Mock mode has no
 * candles: the chart keeps the delayed bars, labelled as such.
 *
 * Regular trading hours only (`tho=true`), matching the public bars, so the
 * session VWAP resets on the same bars either way.
 */

/** The chart's series response, from the feed. */
export interface LiveBarSeries {
  symbol: string;
  timeframe: Timeframe;
  bars: ChartBar[];
  intraday: boolean;
  /** The newest candle's start, e.g. `Nov 06, 2026, 10:35 ET`. */
  asOfLabel: string;
  source: 'tastytrade';
  /** Epoch ms the feed last sent a candle for this series. */
  lastEventMs: number | null;
}

export class LiveCandlesUnavailable extends Error {}

export async function getLiveBars(symbol: string, timeframe: Timeframe, now: number = Date.now()): Promise<LiveBarSeries> {
  if (tastySourceMode() !== 'live') {
    throw new LiveCandlesUnavailable('TASTY_SOURCE is not live; the mock feed has no candles.');
  }
  const spec = CANDLE_SPEC[timeframe];
  const fromTime = now - spec.lookbackDays * 86_400_000;
  // Lazily, so a mock deploy never loads the socket client.
  const { liveCandles } = await import('./dxlink');
  const { bars, lastEventMs, error } = await liveCandles(candleSymbolFor(symbol, timeframe), fromTime);
  if (error || bars.length === 0) throw new LiveCandlesUnavailable(error ?? 'No candles from dxLink.');

  const chartBars: ChartBar[] = bars.map((b) => ({
    t: Math.floor(b.time / 1000),
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
  }));
  return {
    symbol,
    timeframe,
    bars: chartBars,
    intraday: spec.intraday,
    asOfLabel: formatAsOf(new Date(bars[bars.length - 1].time)),
    source: 'tastytrade',
    lastEventMs,
  };
}
