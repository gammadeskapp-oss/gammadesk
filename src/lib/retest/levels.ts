import 'server-only';

import type { DecisionResult } from '../decision/types';
import type { MonitoredLevel } from './types';

/**
 * Which prices the detector watches, and what each one is called.
 *
 * Every level here is one the decision page already computes and already
 * shows. Nothing new is invented: if a price appears in an event line, the
 * reader can find the same price in the panels above it.
 *
 * ## Prior day high and low
 *
 * Taken from the previous session's bars rather than from the chain, because
 * they are facts about price, not about options.
 *
 * ## What is not here
 *
 * The brief also asks for the front-week flip — the gamma flip computed from
 * the nearest expiry alone. This branch has no such level: `lib/exposure.ts`
 * solves one flip across the whole book in scope, and the front-week variant
 * lives on a different branch. Rather than invent a second flip that would not
 * match anything on screen, it is left out and the honesty box says so.
 */

/** Walls each side that are worth watching. Nearest first, as the page lists. */
const WALLS_EACH_SIDE = 3;

/** Two decimals, so a level's id does not change on a floating-point wobble. */
function priceId(prefix: string, price: number): string {
  return `${prefix}-${price.toFixed(2)}`;
}

export interface PriorSession {
  high: number;
  low: number;
}

export function buildLevels(
  decision: DecisionResult,
  vwap: number | null,
  prior: PriorSession | null,
): MonitoredLevel[] {
  const levels: MonitoredLevel[] = [];
  const { context, walls } = decision;

  if (context.flipLevel !== null && context.flipLevel > 0) {
    levels.push({
      // Identified by kind, not by price: the flip is re-solved as the chain
      // updates, so its price is not a stable identity. `machine.ts` throws
      // the state away when it moves materially.
      id: 'flip',
      kind: 'flip',
      price: context.flipLevel,
      label: 'gamma flip',
    });
  }

  /*
   * A wall above price acts as a ceiling and a wall below it acts as a floor.
   * That is the plain-English reading and it is how the levels panel already
   * describes them, so the feed and the panel cannot end up using the same
   * word for different things.
   */
  for (const wall of walls.above.slice(0, WALLS_EACH_SIDE)) {
    levels.push({
      id: priceId('ceiling', wall.strike),
      kind: 'ceiling',
      price: wall.strike,
      label: 'wall',
    });
  }

  for (const wall of walls.below.slice(0, WALLS_EACH_SIDE)) {
    levels.push({
      id: priceId('floor', wall.strike),
      kind: 'floor',
      price: wall.strike,
      label: 'wall',
    });
  }

  if (vwap !== null && vwap > 0) {
    levels.push({
      id: 'vwap',
      kind: 'vwap',
      price: vwap,
      label: 'average price today',
    });
  }

  if (prior) {
    levels.push({
      id: priceId('prior-high', prior.high),
      kind: 'priorHigh',
      price: prior.high,
      label: 'yesterday’s high',
    });
    levels.push({
      id: priceId('prior-low', prior.low),
      kind: 'priorLow',
      price: prior.low,
      label: 'yesterday’s low',
    });
  }

  return levels;
}

/**
 * Yesterday's high and low, from daily bars.
 *
 * @param bars  Daily bars, oldest first, with today's partial bar possibly
 *   last. The previous session is therefore the last bar whose date is not
 *   today's.
 */
export function priorSessionFrom(
  bars: Array<{ t: number; h: number; l: number }>,
  todayOpenSeconds: number,
): PriorSession | null {
  const finished = bars.filter((b) => b.t < todayOpenSeconds);
  const last = finished[finished.length - 1];
  if (!last || !(last.h > 0) || !(last.l > 0)) return null;
  return { high: last.h, low: last.l };
}
