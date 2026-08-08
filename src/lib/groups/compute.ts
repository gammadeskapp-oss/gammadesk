import 'server-only';

import { fetchBars, normaliseSymbol } from '../ticker/bars';
import { latest, sma } from '../ticker/indicators';
import { computeSignals } from '../ticker/signals';
import type { Bar } from '../ticker/types';
import { allTrackedSymbols, GROUPS } from './definitions';
import { labelFor, type GroupScore, type GroupsSnapshot, type MarketInternals, type TickerFailure, type TickerScore } from './types';

/**
 * Computes every group score and the breadth strip in one pass.
 *
 * Bars are fetched once per distinct symbol and shared across groups — NVDA
 * appears in both MAG7 and SEMI but is only fetched once.
 *
 * The batch deliberately goes to Yahoo rather than Polygon. Polygon's stocks
 * quota is 5 requests per minute even on a paid options plan, so fanning 20
 * symbols at it returns mostly 429s and would take four minutes to complete
 * politely. Yahoo absorbed all 20 concurrently in under a second. Polygon
 * stays the preferred source for single-symbol lookups on /ticker, where the
 * quota is ample.
 */

/** Symbols fetched at once. Small enough to stay polite, large enough to be quick. */
const WAVE_SIZE = 5;

/** Sessions used for the 4-week high/low test. */
const FOUR_WEEKS = 20;

async function inWaves<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

interface Loaded {
  symbol: string;
  bars: Bar[] | null;
  reason?: string;
}

function scoreTicker(symbol: string, bars: Bar[]): TickerScore {
  const signals = computeSignals(bars);
  const bullish = signals.filter((s) => s.vote === 'bullish').length;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2] ?? last;

  const lookback = Math.min(20, bars.length - 1);
  const then = bars[bars.length - 1 - lookback]?.close ?? last.close;

  return {
    symbol,
    ok: true,
    price: last.close,
    changePct: prev.close > 0 ? last.close / prev.close - 1 : 0,
    bullish,
    total: signals.length,
    vote: bullish * 2 >= signals.length ? 'bullish' : 'bearish',
    momentum20: then > 0 ? last.close / then - 1 : 0,
    signals: signals.map((s) => ({ name: s.name, vote: s.vote })),
  };
}

function buildInternals(loaded: Loaded[]): MarketInternals {
  let above20 = 0;
  let above50 = 0;
  let at4wHigh = 0;
  let at4wLow = 0;
  let universe = 0;

  for (const entry of loaded) {
    const bars = entry.bars;
    if (!bars || bars.length < 50) continue;
    universe += 1;

    const closes = bars.map((b) => b.close);
    const price = closes[closes.length - 1];

    const ma20 = latest(sma(closes, 20));
    const ma50 = latest(sma(closes, 50));
    if (ma20 !== null && price > ma20) above20 += 1;
    if (ma50 !== null && price > ma50) above50 += 1;

    const window = closes.slice(-FOUR_WEEKS);
    // At a 4-week extreme means today's close IS the extreme of the window,
    // not merely near it.
    if (price >= Math.max(...window)) at4wHigh += 1;
    if (price <= Math.min(...window)) at4wLow += 1;
  }

  const pct = (n: number) => (universe > 0 ? (n / universe) * 100 : 0);

  /*
   * Breadth score, -1 to +1. Participation above the two moving averages is
   * the bulk of it; new highs minus new lows is a smaller, faster-moving
   * confirmation. Centred so 50% participation and no net new highs scores 0.
   */
  const participation = universe > 0 ? (above20 + above50) / (2 * universe) : 0.5;
  const netNew = universe > 0 ? (at4wHigh - at4wLow) / universe : 0;
  const score = Math.max(-1, Math.min(1, (participation - 0.5) * 2 * 0.75 + netNew * 0.25));

  return {
    universe,
    above20,
    above50,
    at4wHigh,
    at4wLow,
    above20Pct: pct(above20),
    above50Pct: pct(above50),
    at4wHighPct: pct(at4wHigh),
    at4wLowPct: pct(at4wLow),
    score,
  };
}

export async function computeGroupsSnapshot(): Promise<GroupsSnapshot> {
  const symbols = allTrackedSymbols();
  const notes: string[] = [];

  const loaded = await inWaves<string, Loaded>(symbols, WAVE_SIZE, async (symbol) => {
    if (!normaliseSymbol(symbol)) {
      return { symbol, bars: null, reason: 'Not a valid ticker symbol.' };
    }
    try {
      const { bars } = await fetchBars(symbol, { prefer: 'yahoo', withName: false });
      return { symbol, bars };
    } catch (error) {
      return {
        symbol,
        bars: null,
        reason: error instanceof Error ? error.message : 'Lookup failed.',
      };
    }
  });

  const bySymbol = new Map(loaded.map((l) => [l.symbol, l]));

  const groups: GroupScore[] = GROUPS.map((definition) => {
    const members: TickerScore[] = [];
    const failures: TickerFailure[] = [];

    for (const symbol of definition.symbols) {
      const entry = bySymbol.get(symbol);
      if (!entry?.bars || entry.bars.length < 60) {
        failures.push({
          symbol,
          ok: false,
          reason: entry?.reason ?? 'Not enough price history.',
        });
        continue;
      }
      members.push(scoreTicker(symbol, entry.bars));
    }

    const bullishTickers = members.filter((m) => m.vote === 'bullish').length;
    const bullishSignals = members.reduce((a, m) => a + m.bullish, 0);
    const totalSignals = members.reduce((a, m) => a + m.total, 0);

    return {
      id: definition.id,
      name: definition.name,
      blurb: definition.blurb,
      members: members.sort((a, b) => b.bullish - a.bullish || a.symbol.localeCompare(b.symbol)),
      failures,
      bullishTickers,
      totalTickers: members.length,
      bullishSignals,
      totalSignals,
      // The headline label is driven by the underlying signal votes rather
      // than the count of tickers, so a group of narrow 5/9 leans does not
      // read as strongly as one of genuine 8/9 calls.
      label: labelFor(bullishSignals, totalSignals),
    };
  });

  const failed = loaded.filter((l) => !l.bars);
  if (failed.length > 0) {
    notes.push(
      `${failed.length} of ${symbols.length} symbols could not be loaded: ${failed
        .map((f) => f.symbol)
        .join(', ')}.`,
    );
  }

  const dates = loaded
    .map((l) => l.bars?.[l.bars.length - 1]?.date)
    .filter((d): d is string => Boolean(d))
    .sort();

  return {
    groups,
    internals: buildInternals(loaded),
    asOfDate: dates[dates.length - 1] ?? '',
    computedAt: new Date().toISOString(),
    requests: symbols.length,
    source: 'yahoo',
    notes,
  };
}
