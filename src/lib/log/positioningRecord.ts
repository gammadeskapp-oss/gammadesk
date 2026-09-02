import { summarise, type LogEntry } from './types';

/**
 * What the accuracy log says about how this book's levels have behaved.
 *
 * ## One symbol, and that is not a temporary state
 *
 * `LogEntry` has no symbol field — `date` is its whole key — and the snapshot
 * job records `config.symbol` and nothing else. So this describes the tracked
 * symbol's history or it describes nothing, and the caller is required to
 * check before rendering it rather than showing another company's record under
 * that company's name. `app/page.tsx` already withholds the log line the same
 * way for the same reason.
 *
 * Adding a symbol field would start a per-ticker series from the day it
 * merged, with no way to backfill the days before — the same trap
 * `history/session.ts` documents. It is deliberately not done here.
 *
 * ## Two windows, not one
 *
 * The flip and magnet figures cover every settled day in the log. The wall
 * figures cover only the days since `stallLevel` and `bounceLevel` started
 * being recorded, which is fewer. They are reported as two windows with their
 * own counts rather than blended into one percentage, because a blended figure
 * would silently weight a short series against a long one and there would be
 * nothing on screen saying so.
 *
 * ## Why walls are counted here rather than read off the entry
 *
 * `magnetTouched` is settled against `magnetAbove`/`magnetBelow` — the LARGEST
 * strike either side, which is the original measure and keeps its meaning
 * forever. The site shows the *nearest strong* wall, which is frequently a
 * different strike, and no settled outcome was ever recorded for it. So the
 * touch is judged here from the stored session high and low, the same way
 * `judge()` does it for magnets, and it inherits the same caveat: a daily bar
 * carries no intraday timing, so a level reached before the morning snapshot
 * still counts and the figure runs slightly high.
 */

export interface WindowStats {
  /** Days in this window that could be judged at all. */
  judged: number;
  /** Of those, the ones that came out the way the level implied. */
  hit: number;
  /** `hit / judged` as a percentage, or null when nothing could be judged. */
  pct: number | null;
  /** First and last session in the window, or null when it is empty. */
  from: string | null;
  to: string | null;
}

export interface PositioningRecord {
  /** Settled days in the log, which is the longest window available. */
  daysSettled: number;
  /** Whether the flip level held its side of the market. */
  flip: WindowStats;
  /** Whether the day's range reached the largest magnet either side. */
  magnet: WindowStats;
  /**
   * Whether the day's range reached the nearest strong wall either side.
   *
   * A shorter window than the two above, and reported as such — these levels
   * were not recorded before 2026-08-31.
   */
  wall: WindowStats;
  /** Sessions spent in each dealer-gamma regime, over the settled days. */
  regimePositive: number;
  regimeNegative: number;
}

function emptyWindow(): WindowStats {
  return { judged: 0, hit: 0, pct: null, from: null, to: null };
}

/** Builds a window from the days that could be judged and the ones that hit. */
function windowOf(judged: LogEntry[], hit: number): WindowStats {
  if (judged.length === 0) return emptyWindow();
  const dates = judged.map((e) => e.date).sort();
  return {
    judged: judged.length,
    hit,
    pct: (hit / judged.length) * 100,
    from: dates[0],
    to: dates[dates.length - 1],
  };
}

/**
 * True when the session's range reached either recorded wall.
 *
 * `undefined` and `null` mean different things and are not collapsed: absent
 * means nobody was recording the level yet, null means the chain published no
 * qualifying wall that day. Only the first excludes a day from the window —
 * a day with no wall to reach is a day the wall was not reached.
 */
function wallTouched(entry: LogEntry): boolean {
  const { stallLevel, bounceLevel, high, low } = entry;
  if (typeof high !== 'number' || typeof low !== 'number') return false;
  if (typeof stallLevel === 'number' && high >= stallLevel) return true;
  if (typeof bounceLevel === 'number' && low <= bounceLevel) return true;
  return false;
}

/** True when a day carries wall levels at all, however they turned out. */
function wallRecorded(entry: LogEntry): boolean {
  return entry.stallLevel !== undefined || entry.bounceLevel !== undefined;
}

export function summarisePositioningRecord(entries: LogEntry[]): PositioningRecord {
  const settled = entries.filter((e) => e.settled);
  const stats = summarise(entries);

  const flipJudged = settled.filter(
    (e) => e.flipOutcome === 'held' || e.flipOutcome === 'broke',
  );
  const magnetJudged = settled.filter(
    (e) => e.magnetTouched !== undefined && (e.magnetAbove !== null || e.magnetBelow !== null),
  );
  const wallJudged = settled.filter(
    (e) => wallRecorded(e) && typeof e.high === 'number' && typeof e.low === 'number',
  );

  return {
    daysSettled: settled.length,
    /*
     * Held is the hit for the flip window: the level did what holding it
     * implied. Touched is the hit for the two level windows, where reaching
     * the strike is the thing the level predicted.
     */
    flip: windowOf(flipJudged, stats.flipHeld),
    magnet: windowOf(magnetJudged, stats.magnetTouched),
    wall: windowOf(wallJudged, wallJudged.filter(wallTouched).length),
    regimePositive: settled.filter((e) => e.regime === 'positive').length,
    regimeNegative: settled.filter((e) => e.regime === 'negative').length,
  };
}
