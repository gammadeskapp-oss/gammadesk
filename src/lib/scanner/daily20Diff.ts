/**
 * The Leadership Change panel — what moved in the Daily 20 since the last run,
 * as plain-English lines.
 *
 * ## Diffs two assembled snapshots, nothing more
 *
 * It takes the previous `Daily20` and the current one and reports the changes.
 * On the first run there is no previous snapshot and it returns nothing — an
 * empty panel is the honest state, not a bug. From the second run on it is
 * populated.
 *
 * ## What it can and cannot see
 *
 * Everything here is computed from the two snapshots alone: who is newly in,
 * who dropped out, who moved ten or more ranks, whose dealer-gamma regime
 * flipped, and whose setup confirmed or failed (a pullback that became a
 * breakout, a breakout that rolled over). Three signals the brief also asks for
 * — a relative-strength breakout to a three-month high, sector-rank shifts, and
 * material options-liquidity/IV changes — need history this diff does not hold
 * (the RS window series, the sectors page's own prior ranks, a stored option
 * snapshot). They are left for when those series are threaded in; see the PR
 * summary. Reporting a change we cannot actually measure would be worse than
 * omitting it.
 *
 * Lines never say buy or sell — they state what changed and let the reader
 * weigh it against the watch line that sits beside every name.
 */

import type { Daily20, Daily20Entry } from './daily20';
import { SETUP_LABEL } from './daily20';
import type { Direction } from './directionScore';

export type ChangeKind =
  | 'entrant'
  | 'exit'
  | 'rank-move'
  | 'regime-flip'
  | 'setup-confirmed'
  | 'setup-failed'
  | 'side-flip';

export interface ChangeLine {
  kind: ChangeKind;
  symbol: string;
  direction: Direction;
  text: string;
}

/**
 * Rank move (in either direction) worth calling out, per the brief.
 *
 * In a ten-deep side the largest possible intra-list move is nine, so this
 * seldom fires on the displayed ranks alone — a name that truly moved ten or
 * more places has entered or left the top ten, and is reported as an entrant or
 * an exit instead. The threshold is kept at the brief's value so that if the
 * snapshot is ever widened past ten the signal is already correct.
 */
export const RANK_MOVE_THRESHOLD = 10;

function sideName(d: Direction): string {
  return d === 'bullish' ? 'leaders' : 'laggards';
}

function indexBySymbol(entries: Daily20Entry[]): Map<string, Daily20Entry> {
  return new Map(entries.map((e) => [e.symbol, e]));
}

function diffSide(
  direction: Direction,
  prev: Daily20Entry[],
  curr: Daily20Entry[],
): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const prevIdx = indexBySymbol(prev);
  const currIdx = indexBySymbol(curr);

  for (const e of curr) {
    const before = prevIdx.get(e.symbol);

    if (!before) {
      lines.push({
        kind: 'entrant',
        symbol: e.symbol,
        direction,
        text: `${e.symbol} enters the ${sideName(direction)} at #${e.rank} — ${e.display.toLowerCase()}.`,
      });
      continue;
    }

    // Rank move of ten or more, either way.
    const move = before.rank - e.rank; // positive = climbed
    if (Math.abs(move) >= RANK_MOVE_THRESHOLD) {
      lines.push({
        kind: 'rank-move',
        symbol: e.symbol,
        direction,
        text: `${e.symbol} ${move > 0 ? 'climbs' : 'slips'} ${Math.abs(move)} to #${e.rank} in the ${sideName(direction)}.`,
      });
    }

    // Dealer-gamma regime flip, where both snapshots measured it.
    const r0 = before.row.regime;
    const r1 = e.row.regime;
    if (r0 !== null && r1 !== null && r0 !== r1) {
      lines.push({
        kind: 'regime-flip',
        symbol: e.symbol,
        direction,
        text: `${e.symbol} gamma regime flips ${r0} → ${r1}.`,
      });
    }

    // Setup confirmed or failed.
    if (before.setup !== e.setup) {
      const confirmed =
        (direction === 'bullish' && e.setup === 'breaking-out' && before.setup !== 'breaking-out') ||
        (direction === 'bearish' && e.setup === 'breaking-down' && before.setup !== 'breaking-down');
      const failed =
        (direction === 'bullish' &&
          before.setup === 'breaking-out' &&
          (e.setup === 'neutral' || e.setup === 'pullback')) ||
        (direction === 'bearish' &&
          before.setup === 'breaking-down' &&
          e.setup === 'neutral');
      if (confirmed) {
        lines.push({
          kind: 'setup-confirmed',
          symbol: e.symbol,
          direction,
          text: `${e.symbol} setup confirmed — ${SETUP_LABEL[e.setup].toLowerCase()}.`,
        });
      } else if (failed) {
        lines.push({
          kind: 'setup-failed',
          symbol: e.symbol,
          direction,
          text: `${e.symbol} setup failed — ${before.setup.replace('-', ' ')} did not hold (now ${SETUP_LABEL[e.setup].toLowerCase()}).`,
        });
      }
    }
  }

  // Exits: in the previous side, not in the current one.
  for (const e of prev) {
    if (!currIdx.has(e.symbol)) {
      lines.push({
        kind: 'exit',
        symbol: e.symbol,
        direction,
        text: `${e.symbol} drops out of the ${sideName(direction)}.`,
      });
    }
  }

  return lines;
}

/**
 * Diff the previous Daily 20 against the current one.
 *
 * Returns an empty list when there is no previous snapshot (the first run).
 * A name that crossed from one side to the other is reported once as a
 * `side-flip` rather than as an exit and an entrance.
 */
export function diffDaily20(prev: Daily20 | null, curr: Daily20): ChangeLine[] {
  if (!prev) return [];

  const prevSymbols = {
    bullish: new Set(prev.bullish.map((e) => e.symbol)),
    bearish: new Set(prev.bearish.map((e) => e.symbol)),
  };

  const raw = [
    ...diffSide('bullish', prev.bullish, curr.bullish),
    ...diffSide('bearish', prev.bearish, curr.bearish),
  ];

  // Collapse an exit on one side plus an entrance on the other into a single
  // side-flip line — a leader that became a laggard is one event, not two.
  const sideFlips = new Map<string, ChangeLine>();
  for (const e of curr.bullish) {
    if (prevSymbols.bearish.has(e.symbol)) {
      sideFlips.set(e.symbol, {
        kind: 'side-flip',
        symbol: e.symbol,
        direction: 'bullish',
        text: `${e.symbol} flips from laggard to leader (now #${e.rank}).`,
      });
    }
  }
  for (const e of curr.bearish) {
    if (prevSymbols.bullish.has(e.symbol)) {
      sideFlips.set(e.symbol, {
        kind: 'side-flip',
        symbol: e.symbol,
        direction: 'bearish',
        text: `${e.symbol} flips from leader to laggard (now #${e.rank}).`,
      });
    }
  }

  const flipped = new Set(sideFlips.keys());
  const filtered = raw.filter(
    (l) => !(flipped.has(l.symbol) && (l.kind === 'entrant' || l.kind === 'exit')),
  );

  return [...sideFlips.values(), ...filtered];
}
