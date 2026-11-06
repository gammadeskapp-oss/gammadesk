import type { Timeframe } from '../bars/types';
import type { DxCandle } from './types';

/**
 * The pure half of /lab's live candles: how a dxFeed `Candle` event updates a
 * series, and which candle symbol a chart timeframe asks for. No socket, no
 * `server-only`, so `scripts/verify-tasty-candles.mjs` can run it directly.
 */

// dxFeed event flags on a HISTORY-contract feed (Candle under contract AUTO).
export const FLAG_REMOVE_EVENT = 0x02;
export const FLAG_SNAPSHOT_BEGIN = 0x04;
export const FLAG_SNAPSHOT_END = 0x08;
export const FLAG_SNAPSHOT_SNIP = 0x10;

/** One candle series as received: bars by start time, and whether the history snapshot finished. */
export interface CandleBook {
  bars: Map<number, DxCandle>;
  complete: boolean;
  /** Epoch ms this process last received a candle for the series. */
  lastAt: number;
}

export function emptyCandleBook(): CandleBook {
  return { bars: new Map(), complete: false, lastAt: 0 };
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return Number.NaN;
}

/**
 * One raw candle record into its series. The history arrives newest-first
 * between a SNAPSHOT_BEGIN and a SNAPSHOT_END (or SNIP) flag, then the live bar
 * keeps updating in place. A REMOVE flag, or a NaN close, deletes that bar.
 */
export function applyCandle(book: CandleBook, raw: Record<string, unknown>, now: number): void {
  const flags = num(raw.eventFlags) || 0;
  if (flags & FLAG_SNAPSHOT_BEGIN) {
    book.bars.clear();
    book.complete = false;
  }
  const time = num(raw.time);
  const close = num(raw.close);
  if (Number.isFinite(time) && time > 0) {
    if (flags & FLAG_REMOVE_EVENT || !Number.isFinite(close)) {
      book.bars.delete(time);
    } else {
      const open = num(raw.open);
      const high = num(raw.high);
      const low = num(raw.low);
      const volume = num(raw.volume);
      book.bars.set(time, {
        time,
        open: Number.isFinite(open) ? open : close,
        high: Number.isFinite(high) ? high : close,
        low: Number.isFinite(low) ? low : close,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      });
    }
  }
  if (flags & (FLAG_SNAPSHOT_END | FLAG_SNAPSHOT_SNIP)) book.complete = true;
  book.lastAt = now;
}

/** Bars from `fromTime` on, oldest first. */
export function candleBars(book: CandleBook | undefined, fromTime: number): DxCandle[] {
  if (!book) return [];
  return [...book.bars.values()].filter((b) => b.time >= fromTime).sort((a, b) => a.time - b.time);
}

interface CandleSpec {
  /** dxFeed aggregation period, the `=` attribute of the candle symbol. */
  period: string;
  /** History requested, in days back from now. */
  lookbackDays: number;
  intraday: boolean;
}

export const CANDLE_SPEC: Record<Timeframe, CandleSpec> = {
  '1m': { period: '1m', lookbackDays: 3, intraday: true },
  '5m': { period: '5m', lookbackDays: 14, intraday: true },
  '15m': { period: '15m', lookbackDays: 30, intraday: true },
  '1h': { period: '1h', lookbackDays: 90, intraday: true },
  '4h': { period: '4h', lookbackDays: 180, intraday: true },
  '1D': { period: '1d', lookbackDays: 730, intraday: false },
};

/**
 * `SPY{=5m,tho=true}` — regular trading hours only, matching the public bars so
 * the session VWAP resets on the same bars. Daily bars carry no hours attribute.
 */
export function candleSymbolFor(symbol: string, timeframe: Timeframe): string {
  const spec = CANDLE_SPEC[timeframe];
  return spec.intraday ? `${symbol}{=${spec.period},tho=true}` : `${symbol}{=${spec.period}}`;
}
