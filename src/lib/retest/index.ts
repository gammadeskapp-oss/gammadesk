import 'server-only';

import { getBars } from '../bars/intraday';
import { breadthAt } from '../breadth';
import { readBreadthDoc } from '../breadth/store';
import { cached } from '../cache';
import { getDecision } from '../decision';
import { formatEtClock } from '../scanner/schedule';
import { marketTimeToUtcMs, marketToday } from '../time';
import { fetchSessionBars, type BarSource } from './bars';
import { buildLevels, priorSessionFrom } from './levels';
import {
  bufferFor,
  initialState,
  levelMovedAway,
  step,
  volumeAboveAverage,
  ATR_PERIOD,
  EVENT_COOLDOWN_MINUTES,
  RETEST_TIMEOUT_MINUTES,
  type Bar,
} from './machine';
import { readRetestDoc, writeRetestDoc, type RetestDoc } from './store';
import type { LevelState, MonitoredLevel, RetestEvent } from './types';

export { storeStatus } from './store';
export {
  ATR_PERIOD,
  EVENT_COOLDOWN_MINUTES,
  MIN_BUFFER_PCT,
  ATR_BUFFER_MULTIPLE,
  RETEST_TIMEOUT_MINUTES,
} from './machine';
export type * from './types';

/**
 * The failed-retest detector: one refresh, and one read.
 *
 * Pages call `getRetests`, which only reads storage. The bar fetch and the
 * state machine run in the cron route, so a page view never spends an upstream
 * request and cannot advance the feed by being loaded.
 */

/** Bars of context the machine wants before it will trust a buffer. */
const WARMUP_BARS = ATR_PERIOD + 1;

export interface RefreshResult {
  symbol: string;
  /** Events emitted by this run alone. */
  fired: RetestEvent[];
  levels: number;
  bars: number;
  source: BarSource | null;
  notes: string[];
}

/** Epoch seconds at 09:30 New York on a session date. */
function sessionOpenSeconds(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return marketTimeToUtcMs(y, m, d, 9, 30) / 1000;
}

/**
 * Whether an event on the gamma flip changed the regime, and to what.
 *
 * Crossing the flip is not just another level break: above it, dealer hedging
 * leans against moves and dampens them; below it, the hedging leans with them
 * and amplifies them. So a flip event is emitted as its own kind of thing
 * rather than as one line among many.
 *
 * Only a confirmed outcome counts. A fake break across the flip is precisely
 * the case where the regime did NOT change, and calling it a regime flip would
 * be the most misleading line the feed could print.
 */
function regimeFor(event: {
  outcome: string;
  direction: 'up' | 'down';
}): 'calm' | 'wild' | null {
  if (event.outcome !== 'failed-retest') return null;
  // Taken upwards and held: price is above the flip, hedging dampens moves.
  // Lost downwards and rejected: price is below it, hedging amplifies them.
  return event.direction === 'up' ? 'calm' : 'wild';
}

/**
 * Fold every unseen bar into every level, and collect what fired.
 *
 * The states carry across refreshes, so a level that broke an hour ago is
 * still broken now — see `store.ts` for why this is not recomputed from
 * scratch each time.
 */
function advance(
  levels: MonitoredLevel[],
  bars: Bar[],
  states: Record<string, LevelState>,
  breadthSamples: Parameters<typeof breadthAt>[0],
): { states: Record<string, LevelState>; fired: RetestEvent[] } {
  const nextStates: Record<string, LevelState> = {};
  const fired: RetestEvent[] = [];

  for (const level of levels) {
    const stored = states[level.id];

    /*
     * A level that has moved materially is a different level, and its stored
     * state is about a price that is no longer on screen. Thrown away rather
     * than carried — see `levelMovedAway`.
     */
    let state =
      stored && !levelMovedAway(stored, level.price)
        ? { ...stored, price: level.price }
        : initialState(level, stored?.lastBarTime ?? 0);

    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i];
      if (bar.t <= state.lastBarTime) continue;

      /*
       * The buffer is measured from the bars up to and including this one, so
       * it reflects how volatile the tape actually was at that moment rather
       * than how volatile it became later.
       */
      const window = bars.slice(Math.max(0, i - WARMUP_BARS), i + 1);
      const buffer = bufferFor(level.price, window);

      const result = step(
        state,
        bar,
        level.price,
        buffer,
        volumeAboveAverage(bars, i),
      );
      state = result.state;

      if (!result.event) continue;

      const firedAtDate = new Date(result.event.firedAt);
      const breadth = breadthAt(breadthSamples, firedAtDate);
      const regime = level.kind === 'flip' ? regimeFor(result.event) : null;

      fired.push({
        id: `${level.id}:${result.event.firedAt}`,
        levelId: level.id,
        kind: level.kind,
        // Pinned to the level as it stood when this fired, not as it stands
        // now. This is the whole reason the feed cannot rewrite its history.
        levelPrice: level.price,
        label: level.label,
        direction: result.event.direction,
        outcome: result.event.outcome,
        brokenAt: result.event.brokenAt,
        retestedAt: result.event.retestedAt,
        firedAt: result.event.firedAt,
        etClock: formatEtClock(firedAtDate),
        volumeAboveAverage: result.event.volumeAboveAverage,
        breadthPct: breadth?.pct ?? null,
        regime,
      });
    }

    nextStates[level.id] = state;
  }

  return { states: nextStates, fired };
}

/**
 * One refresh for one symbol.
 *
 * Everything it needs is already computed elsewhere: the levels come from the
 * decision page's own numbers, the bars from the price feed, the breadth
 * reading from the meter that runs alongside this. Nothing here re-derives a
 * figure that is shown somewhere else.
 */
export async function refreshRetests(
  symbol: string,
  now: Date = new Date(),
): Promise<RefreshResult> {
  const notes: string[] = [];

  const session = await fetchSessionBars(symbol, now);
  if (!session || session.bars.length === 0) {
    return {
      symbol,
      fired: [],
      levels: 0,
      bars: 0,
      source: null,
      notes: ['No one-minute bars for this session yet, so there is nothing to watch.'],
    };
  }

  if (session.vwapDerived) {
    notes.push(
      'The average price for the day is worked out from one-minute bars, not taken from the feed, so it may differ slightly from the figure on a broker’s chart.',
    );
  }

  const openSeconds = sessionOpenSeconds(marketToday(now));

  const [decision, daily, breadthDoc] = await Promise.all([
    getDecision(symbol).catch(() => null),
    getBars(symbol, '1D').catch(() => null),
    readBreadthDoc(now),
  ]);

  if (!decision) {
    return {
      symbol,
      fired: [],
      levels: 0,
      bars: session.bars.length,
      source: session.source,
      notes: [
        'The option chain could not be read, so there are no gamma levels to watch this refresh.',
      ],
    };
  }

  const prior = daily ? priorSessionFrom(daily.bars, openSeconds) : null;
  if (!prior) {
    notes.push('Yesterday’s high and low could not be read, so they are not being watched.');
  }

  const levels = buildLevels(decision, session.vwap, prior);
  if (levels.length === 0) {
    notes.push('No levels were available to watch this refresh.');
  }

  const doc = await readRetestDoc(symbol, now);
  const { states, fired } = advance(levels, session.bars, doc.states, breadthDoc.samples);

  const next: RetestDoc = {
    ...doc,
    states,
    // Newest first, which is the order the feed renders in.
    events: [...fired.reverse(), ...doc.events],
    updatedAt: now.toISOString(),
  };

  await writeRetestDoc(next);

  return {
    symbol,
    fired,
    levels: levels.length,
    bars: session.bars.length,
    source: session.source,
    notes,
  };
}

export interface RetestFeed {
  symbol: string;
  /** Newest first. */
  events: RetestEvent[];
  /**
   * The regime the newest gamma-flip event established, if there was one.
   *
   * Carried so the context block's regime badge and this feed can never
   * disagree about which side of the flip the session is on.
   */
  regime: 'calm' | 'wild' | null;
  notes: string[];
}

/**
 * What the pages render. Reads storage only.
 *
 * Cached briefly so the feed and anything else reading it in the same render
 * share one store read. The refresh writes at most once a minute, so a short
 * reuse cannot hide anything the viewer could otherwise have seen.
 */
export function getRetests(symbol: string): Promise<RetestFeed> {
  return cached(`retests:${symbol}`, 30, async () => {
    const doc = await readRetestDoc(symbol);
    const latestFlip = doc.events.find((e) => e.regime !== null);

    return {
      symbol,
      events: doc.events,
      regime: latestFlip?.regime ?? null,
      notes: [],
    } satisfies RetestFeed;
  });
}
