import 'server-only';

import { fetchBars } from '../ticker/bars';
import { rsi } from '../ticker/indicators';
import { computeSignals } from '../ticker/signals';
import type { Bar } from '../ticker/types';
import { allSectorSymbols, duplicateSymbols, SECTORS } from './definitions';
import type {
  ScorePoint,
  SectorFlag,
  SectorMomentum,
  SectorsSnapshot,
  SymbolHistory,
} from './types';

/**
 * Sector momentum: how each sector's nine-signal score is *changing*.
 *
 * ## Where the history comes from
 *
 * Nothing stored a daily score before this. The groups job overwrites one
 * snapshot each run, so there was no series to difference and no sparkline to
 * draw — waiting for one to accumulate would have left the page blank for a
 * week.
 *
 * It does not need to. `computeSignals` is a pure function of the bar array,
 * so the score as of five sessions ago is just the score computed on the bars
 * up to five sessions ago. The history is therefore *derived* on every run
 * rather than accumulated, which means the page is complete from its first
 * run and self-corrects if a day is ever missed.
 *
 * It costs nothing extra upstream either: one bar fetch per symbol, then the
 * signals recomputed ten times over slices of an array already in memory.
 */

/** Sessions of history kept. Enough for a 5-day delta and a readable spark. */
const SESSIONS = 10;

/** Signals need this many bars before they mean anything. */
const MIN_BARS = 60;

/** Symbols fetched at once. Yahoo absorbed twenty concurrently without complaint. */
const WAVE = 5;

/*
 * Sector averages compress hard, so the usual 30/70 would flag nothing.
 *
 * Measured across these eight sectors on a normal session, the ten-day range
 * of sector-average RSI ran from 43 to 64 — the extremes a single stock
 * reaches are simply averaged away by five or seven members. At 35/65 the two
 * flags would have been dead code. Forty and sixty are stretched for an
 * average (a sector at 60 has several members in the high sixties) while still
 * firing occasionally, which is what a flag is for.
 */
const OVERSOLD = 40;
const OVERBOUGHT = 60;

/** One symbol's score at each of the last `SESSIONS` closes. */
function historyFor(symbol: string, bars: Bar[]): SymbolHistory | null {
  if (bars.length < MIN_BARS + 1) return null;

  const closes = bars.map((b) => b.close);
  const rsiSeries = rsi(closes, 14);

  const points: ScorePoint[] = [];
  const oldest = Math.min(SESSIONS, bars.length - MIN_BARS);

  // Walk backwards, then flip, so `points` ends up oldest-first.
  for (let back = oldest - 1; back >= 0; back -= 1) {
    const end = bars.length - back;
    const slice = bars.slice(0, end);
    if (slice.length < MIN_BARS) continue;

    const signals = computeSignals(slice);
    if (signals.length === 0) continue;

    const bullish = signals.filter((s) => s.vote === 'bullish').length;

    points.push({
      date: slice[slice.length - 1].date,
      score: (bullish / signals.length) * 100,
      rsi: rsiSeries[end - 1] ?? 50,
    });
  }

  return points.length > 0 ? { symbol, points } : null;
}

/** Averages member series into one sector series, session by session. */
function averageSeries(histories: SymbolHistory[]): ScorePoint[] {
  // Align on the shortest member, so every averaged point has the same
  // membership. Padding a missing symbol with its neighbours' scores would
  // invent a change that nobody's signals produced.
  const depth = Math.min(...histories.map((h) => h.points.length));
  if (!Number.isFinite(depth) || depth <= 0) return [];

  const out: ScorePoint[] = [];
  for (let i = 0; i < depth; i += 1) {
    // Count back from the end of each series so the newest sessions align.
    const slice = histories.map((h) => h.points[h.points.length - depth + i]);
    out.push({
      date: slice[0].date,
      score: slice.reduce((a, p) => a + p.score, 0) / slice.length,
      rsi: slice.reduce((a, p) => a + p.rsi, 0) / slice.length,
    });
  }
  return out;
}

function deltaAgo(series: ScorePoint[], sessions: number): number | null {
  const from = series[series.length - 1 - sessions];
  const to = series[series.length - 1];
  return from && to ? to.score - from.score : null;
}

/**
 * The two turn flags.
 *
 * Both require a stretch *and* a turn: being oversold is not by itself
 * bottoming, and the page would be worthless if it said so on every weak
 * sector. The extreme must be in the recent window and the score must now be
 * moving the other way.
 */
function flagFor(series: ScorePoint[], delta3: number | null): SectorFlag | null {
  if (series.length < 4 || delta3 === null) return null;

  const rsis = series.map((p) => p.rsi);
  const low = Math.min(...rsis);
  const high = Math.max(...rsis);

  if (low <= OVERSOLD && delta3 > 0) return 'bottoming';
  if (high >= OVERBOUGHT && delta3 < 0) return 'topping';
  return null;
}

async function inWaves<T>(
  symbols: string[],
  worker: (symbol: string) => Promise<T>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < symbols.length; i += WAVE) {
    out.push(...(await Promise.all(symbols.slice(i, i + WAVE).map(worker))));
  }
  return out;
}

export async function computeSectorsSnapshot(): Promise<SectorsSnapshot> {
  const symbols = allSectorSymbols();

  const loaded = await inWaves(symbols, async (symbol) => {
    try {
      // Yahoo, because Polygon's stocks quota is five requests a minute and
      // this is a forty-symbol fan-out.
      const { bars } = await fetchBars(symbol, { prefer: 'yahoo', withName: false });
      return { symbol, history: historyFor(symbol, bars) };
    } catch {
      return { symbol, history: null };
    }
  });

  const bySymbol = new Map(
    loaded.filter((l) => l.history).map((l) => [l.symbol, l.history as SymbolHistory]),
  );

  const notes: string[] = [];
  const failed = loaded.filter((l) => !l.history).map((l) => l.symbol);
  if (failed.length > 0) {
    notes.push(`No usable history for ${failed.length} symbols: ${failed.join(', ')}.`);
  }

  const duplicates = duplicateSymbols();
  if (duplicates.length > 0) {
    notes.push(
      `${duplicates.join(', ')} appear in more than one sector, so those averages share a constituent.`,
    );
  }

  const sectors: SectorMomentum[] = [];

  for (const definition of SECTORS) {
    const histories = definition.symbols
      .map((s) => bySymbol.get(s))
      .filter((h): h is SymbolHistory => h !== undefined);

    const missing = definition.symbols.filter((s) => !bySymbol.has(s));
    const series = histories.length > 0 ? averageSeries(histories) : [];
    if (series.length === 0) continue;

    const delta3 = deltaAgo(series, 3);
    const rsis = series.map((p) => p.rsi);

    sectors.push({
      id: definition.id,
      name: definition.name,
      blurb: definition.blurb,
      members: histories.map((h) => h.symbol),
      failures: missing,
      series,
      score: series[series.length - 1].score,
      delta1: deltaAgo(series, 1),
      delta3,
      delta5: deltaAgo(series, 5),
      rsiLow: Math.min(...rsis),
      rsiHigh: Math.max(...rsis),
      rsiNow: series[series.length - 1].rsi,
      flag: flagFor(series, delta3),
    });
  }

  const newest = sectors
    .map((s) => s.series[s.series.length - 1]?.date ?? '')
    .sort()
    .pop();

  return {
    sectors,
    asOfDate: newest ?? '',
    computedAt: new Date().toISOString(),
    sessions: Math.max(0, ...sectors.map((s) => s.series.length)),
    notes,
  };
}

export const SECTOR_THRESHOLDS = { OVERSOLD, OVERBOUGHT, SESSIONS };
