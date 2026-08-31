import 'server-only';

import { getBars } from '../bars/intraday';
import { marketTimeToUtcMs, marketToday } from '../time';
import { tradierToken } from '../breadth/tradier';
import type { Bar } from './machine';

/**
 * One-minute bars for the session in progress, and the session VWAP.
 *
 * "VWAP" is volume-weighted average price: the average price of the day with
 * each price counted in proportion to how much traded there. It is one of the
 * levels the detector watches, so it has to come from the same bars as
 * everything else or the two would disagree about where it is.
 *
 * ## Two sources
 *
 * Tradier's time-and-sales endpoint returns one-minute bars carrying open,
 * high, low, close, volume AND a per-bar VWAP. Verified against the live API
 * on 2026-08-30 for a full session: 390 bars, each with a `vwap` field. That
 * is the whole input the detector needs from one request.
 *
 * Yahoo's chart endpoint is the fallback. It returns the same OHLCV but no
 * VWAP, so on that path the session VWAP is computed here from the bars —
 * using each bar's typical price weighted by its volume, which is the standard
 * construction and is close to, but not identical to, a true tick-by-tick
 * VWAP. Which source answered is reported, because the difference is real.
 */

const TIMESALES_URL = 'https://api.tradier.com/v1/markets/timesales';

export type BarSource = 'tradier' | 'yahoo';

export interface SessionBars {
  bars: Bar[];
  source: BarSource;
  /**
   * Session volume-weighted average price, or null when there is no volume to
   * weight by.
   */
  vwap: number | null;
  /** True when the VWAP was computed here rather than supplied by the feed. */
  vwapDerived: boolean;
}

interface RawTimesale {
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  vwap?: number;
}

/**
 * Volume-weighted average price across a set of bars.
 *
 * Each bar contributes its typical price — the mean of high, low and close —
 * weighted by its volume. Bars with no volume contribute nothing rather than
 * dragging the average toward a price nothing traded at.
 */
export function sessionVwap(bars: Bar[]): number | null {
  let weighted = 0;
  let volume = 0;
  for (const bar of bars) {
    if (!(bar.v > 0)) continue;
    weighted += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    volume += bar.v;
  }
  return volume > 0 ? weighted / volume : null;
}

/** Weighted by volume, using the feed's own per-bar VWAP where it has one. */
function vwapFromFeed(bars: Bar[], perBar: number[]): number | null {
  let weighted = 0;
  let volume = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const v = bars[i].v;
    if (!(v > 0) || !Number.isFinite(perBar[i])) continue;
    weighted += perBar[i] * v;
    volume += v;
  }
  return volume > 0 ? weighted / volume : null;
}

async function fromTradier(symbol: string, date: string): Promise<SessionBars | null> {
  const token = tradierToken();
  if (!token) return null;

  const params = new URLSearchParams({
    symbol,
    interval: '1min',
    start: `${date} 09:30`,
    end: `${date} 16:00`,
    // Regular trading hours only. Pre-market and after-hours bars are thin
    // enough that a level "breaking" on one of them is an artefact of nobody
    // trading, not of price going anywhere.
    session_filter: 'open',
  });

  const response = await fetch(`${TIMESALES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });

  if (!response.ok) return null;

  const body = (await response.json()) as {
    series?: { data?: RawTimesale | RawTimesale[] } | null;
  };

  const raw = body.series?.data;
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];

  const bars: Bar[] = [];
  const perBar: number[] = [];

  for (const item of list) {
    const { timestamp, open, high, low, close, volume } = item;
    if (
      typeof timestamp !== 'number' ||
      typeof open !== 'number' ||
      typeof high !== 'number' ||
      typeof low !== 'number' ||
      typeof close !== 'number'
    ) {
      continue;
    }
    bars.push({
      t: timestamp,
      o: open,
      h: high,
      l: low,
      c: close,
      v: typeof volume === 'number' ? volume : 0,
    });
    perBar.push(typeof item.vwap === 'number' ? item.vwap : NaN);
  }

  if (bars.length === 0) return null;

  const fromFeed = vwapFromFeed(bars, perBar);
  return {
    bars,
    source: 'tradier',
    vwap: fromFeed ?? sessionVwap(bars),
    vwapDerived: fromFeed === null,
  };
}

/**
 * Epoch seconds at 09:30 New York on the given session date.
 *
 * Through the project's own helper, which resolves the offset from the IANA
 * database, so this is right on both sides of a daylight-saving change rather
 * than four hours out for half the year.
 */
function sessionOpenSeconds(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return marketTimeToUtcMs(y, m, d, 9, 30) / 1000;
}

async function fromYahoo(symbol: string, date: string): Promise<SessionBars | null> {
  const series = await getBars(symbol, '1m').catch(() => null);
  if (!series) return null;

  const open = sessionOpenSeconds(date);
  // Yahoo's 1m range covers several days; only today's session is the subject.
  const bars = series.bars.filter((b) => b.t >= open);
  if (bars.length === 0) return null;

  return { bars, source: 'yahoo', vwap: sessionVwap(bars), vwapDerived: true };
}

/**
 * @returns null when neither source produced bars for the session, which is
 * the normal state before the open.
 */
export async function fetchSessionBars(
  symbol: string,
  now: Date = new Date(),
): Promise<SessionBars | null> {
  const date = marketToday(now);
  const tradier = await fromTradier(symbol, date).catch(() => null);
  if (tradier) return tradier;
  return fromYahoo(symbol, date).catch(() => null);
}
