/**
 * The state machine, and nothing else.
 *
 * No `server-only`, no fetching, no storage — `scripts/verify-retests.mjs`
 * imports this file and drives it with hand-built bars, so every transition
 * can be checked against a sequence worked out on paper. The rest of the
 * folder supplies bars and levels and writes down what comes out.
 *
 * ## What it is looking for
 *
 * A single candle poking through a level says nothing; price wanders. What is
 * worth naming is the sequence: a level breaks, price comes back to check
 * whether it can get back in, and either it does or it does not.
 *
 *   holding  -> the level has not been broken
 *   broken   -> a bar CLOSED beyond it by more than the buffer
 *   retested -> price came back to touch the level again
 *
 * From `retested` there are two ways out. Closing back on the original side is
 * a FAKE BREAK — the move did not stick. Failing to close back, and then
 * extending away on the next bar, is a FAILED RETEST — the level rejected the
 * attempt to return.
 *
 * ## Both directions, equally
 *
 * The machine is written once and runs identically upwards and downwards. A
 * level lost downwards and then rejected, and a level taken upwards that then
 * holds, are the same event mirrored — the wording differs, the logic does
 * not. Nothing here defaults to the downside.
 */

import type {
  BreakDirection,
  EventOutcome,
  LevelState,
  MonitoredLevel,
} from './types';

/** One minute of trading. */
export interface Bar {
  /** Epoch seconds at the start of the minute. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Bars used for the average-range measure behind the buffer. */
export const ATR_PERIOD = 14;
/** Bars the breaking bar's volume is compared against. */
export const VOLUME_LOOKBACK = 20;
/** Least the buffer can be, as a share of the level. */
export const MIN_BUFFER_PCT = 0.001;
/** Share of the average range that sets the buffer when it is the larger. */
export const ATR_BUFFER_MULTIPLE = 0.25;
/** Minutes after a break with no retest before the level is reset. */
export const RETEST_TIMEOUT_MINUTES = 30;
/** Minutes a level must wait before it may produce another event. */
export const EVENT_COOLDOWN_MINUTES = 15;
/**
 * How far the flip may move before its stored state is thrown away.
 *
 * The gamma flip is re-solved whenever the option chain updates, so it is not
 * a fixed price the way a strike is. A break of an earlier flip level is not a
 * break of the current one, and carrying "broken" across a move of any size
 * would eventually report an event about a price that no longer exists. A
 * tenth of a percent is the same order as the buffer itself.
 */
export const LEVEL_DRIFT_RESET_PCT = 0.001;

/**
 * Average true range — the average distance a bar covers, counting any gap
 * from the previous close.
 *
 * Used only to size the buffer. A quiet tape gets a tight buffer and a violent
 * one gets a wide buffer, so the same rule does not fire constantly on one day
 * and never on another.
 *
 * @returns null when there are not enough bars to measure.
 */
export function atr(bars: Bar[], period = ATR_PERIOD): number | null {
  if (bars.length < period + 1) return null;

  const ranges: number[] = [];
  for (let i = bars.length - period; i < bars.length; i += 1) {
    const bar = bars[i];
    const prevClose = bars[i - 1].c;
    ranges.push(
      Math.max(
        bar.h - bar.l,
        Math.abs(bar.h - prevClose),
        Math.abs(bar.l - prevClose),
      ),
    );
  }

  return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

/**
 * How far beyond a level a close has to be before it counts as a break.
 *
 * The larger of a tenth of a percent of the level and a quarter of the average
 * bar range. This is a judgement call rather than a law, and the page says so:
 * a different buffer produces a different set of events from the same session.
 */
export function bufferFor(level: number, bars: Bar[]): number {
  const floor = Math.abs(level) * MIN_BUFFER_PCT;
  const range = atr(bars);
  return range === null ? floor : Math.max(floor, range * ATR_BUFFER_MULTIPLE);
}

/** Whether the bar at `index` traded more than the recent average. */
export function volumeAboveAverage(bars: Bar[], index: number): boolean {
  const from = Math.max(0, index - VOLUME_LOOKBACK);
  const window = bars.slice(from, index);
  if (window.length === 0) return false;
  const mean = window.reduce((sum, b) => sum + b.v, 0) / window.length;
  return mean > 0 && bars[index].v > mean;
}

/** A fresh, unbroken state for a level. */
export function initialState(level: MonitoredLevel, lastBarTime = 0): LevelState {
  return {
    levelId: level.id,
    price: level.price,
    status: 'holding',
    direction: null,
    brokenAt: null,
    volumeAboveAverage: false,
    retestedAt: null,
    retestExtreme: null,
    settled: false,
    lastBarTime,
    lastEventAt: null,
  };
}

/** A reset that keeps the identity and the cooldown, and drops the sequence. */
function reset(state: LevelState, price: number, barTime: number): LevelState {
  return {
    levelId: state.levelId,
    price,
    status: 'holding',
    direction: null,
    brokenAt: null,
    volumeAboveAverage: false,
    retestedAt: null,
    retestExtreme: null,
    settled: false,
    lastBarTime: barTime,
    lastEventAt: state.lastEventAt,
  };
}

/** What one bar did to one level. */
export interface StepEvent {
  direction: BreakDirection;
  outcome: EventOutcome;
  brokenAt: string;
  retestedAt: string | null;
  firedAt: string;
  volumeAboveAverage: boolean;
}

export interface StepResult {
  state: LevelState;
  /** Present when this bar completed a sequence worth naming. */
  event: StepEvent | null;
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function minutesBetween(fromIso: string, toSeconds: number): number {
  return (toSeconds * 1000 - Date.parse(fromIso)) / 60_000;
}

/**
 * Whether this level may emit right now.
 *
 * A level sitting exactly on the buffer can cross it repeatedly, and without
 * this one indecisive price would fill the whole feed with the same
 * observation. One event per level per quarter of an hour.
 */
function coolingDown(state: LevelState, barTime: number): boolean {
  if (!state.lastEventAt) return false;
  return minutesBetween(state.lastEventAt, barTime) < EVENT_COOLDOWN_MINUTES;
}

/**
 * Fold one bar into one level's state.
 *
 * @param level   The level's price for this bar.
 * @param buffer  Distance beyond it a close must clear, from `bufferFor`.
 * @param volumeFlag  Whether this bar out-traded the recent average. Passed in
 *   rather than computed here, so the machine stays a pure function of the
 *   state and the bar.
 */
export function step(
  state: LevelState,
  bar: Bar,
  level: number,
  buffer: number,
  volumeFlag: boolean,
): StepResult {
  const next: LevelState = { ...state, price: level, lastBarTime: bar.t };
  const at = iso(bar.t);

  if (state.status === 'holding') {
    /*
     * A break is a CLOSE beyond the level by more than the buffer. Wicks are
     * ignored on purpose — a spike that closes back inside is exactly the poke
     * this detector exists in order not to report.
     */
    const brokeDown = bar.c < level - buffer;
    const brokeUp = bar.c > level + buffer;
    if (!brokeDown && !brokeUp) return { state: next, event: null };

    return {
      state: {
        ...next,
        status: 'broken',
        direction: brokeDown ? 'down' : 'up',
        brokenAt: at,
        volumeAboveAverage: volumeFlag,
        retestedAt: null,
        retestExtreme: null,
      },
      event: null,
    };
  }

  const direction: BreakDirection = state.direction ?? 'down';
  /** True when this bar closed back on the side price started from. */
  const reclaimed = direction === 'down' ? bar.c > level : bar.c < level;

  if (state.status === 'broken') {
    if (reclaimed) {
      /*
       * Closed back where it started. That is a FAKE BREAK only while the
       * break was still unconfirmed — once it has already been named, price
       * coming back is simply the level re-arming, and calling it a fake break
       * would contradict the line printed earlier.
       */
      const emit = !state.settled && !coolingDown(state, bar.t);
      return {
        state: { ...reset(state, level, bar.t), lastEventAt: emit ? at : state.lastEventAt },
        event: emit
          ? {
              direction,
              outcome: 'fake-break',
              brokenAt: state.brokenAt ?? at,
              retestedAt: null,
              firedAt: at,
              volumeAboveAverage: state.volumeAboveAverage,
            }
          : null,
      };
    }

    // Back within touching distance: price has come to check the level.
    const touched =
      direction === 'down' ? bar.h >= level - buffer : bar.l <= level + buffer;

    if (touched) {
      return {
        state: {
          ...next,
          status: 'retested',
          retestedAt: at,
          retestExtreme: direction === 'down' ? bar.l : bar.h,
        },
        event: null,
      };
    }

    /*
     * Broke and never came back to check within the timeout. Named once, and
     * then the level STAYS broken rather than re-arming.
     *
     * Re-arming here was a real defect, caught by replaying a live session:
     * the level resets to holding, price is still far beyond it, so the very
     * next bar breaks it again and thirty minutes later it times out again.
     * One level produced six identical lines at exact half-hour intervals —
     * a description of the clock, not of the tape. Staying broken means it
     * waits for price to actually return, which is the only thing that could
     * make it interesting again.
     */
    if (
      !state.settled &&
      state.brokenAt &&
      minutesBetween(state.brokenAt, bar.t) >= RETEST_TIMEOUT_MINUTES
    ) {
      const emit = !coolingDown(state, bar.t);
      return {
        state: {
          ...next,
          settled: true,
          lastEventAt: emit ? at : state.lastEventAt,
        },
        event: emit
          ? {
              direction,
              outcome: 'broke-and-left',
              brokenAt: state.brokenAt,
              retestedAt: null,
              firedAt: at,
              volumeAboveAverage: state.volumeAboveAverage,
            }
          : null,
      };
    }

    return { state: next, event: null };
  }

  // status === 'retested'
  if (reclaimed) {
    const emit = !state.settled && !coolingDown(state, bar.t);
    return {
      state: { ...reset(state, level, bar.t), lastEventAt: emit ? at : state.lastEventAt },
      event: emit
        ? {
            direction,
            outcome: 'fake-break',
            brokenAt: state.brokenAt ?? at,
            retestedAt: state.retestedAt,
            firedAt: at,
            volumeAboveAverage: state.volumeAboveAverage,
          }
        : null,
    };
  }

  /*
   * Failed to get back in, and now extending away from the level: a lower low
   * than the retest after a downward break, a higher high after an upward one.
   * That second condition is what separates "has not got back in yet" from
   * "was pushed away".
   */
  const extended =
    state.retestExtreme !== null &&
    (direction === 'down' ? bar.l < state.retestExtreme : bar.h > state.retestExtreme);

  if (extended) {
    // Once per break. A level that rejects price, is approached again and
    // rejects it again is the same break being confirmed twice; the feed would
    // print two lines both reading "lost 12:18".
    const emit = !state.settled && !coolingDown(state, bar.t);
    return {
      state: {
        /*
         * Back to `broken`, not to `holding`. The level really is on the other
         * side of price now, and re-arming here would let one continuing move
         * report itself over and over as it ran.
         */
        ...next,
        status: 'broken',
        retestedAt: null,
        retestExtreme: null,
        settled: state.settled || emit,
        lastEventAt: emit ? at : state.lastEventAt,
      },
      event: emit
        ? {
            direction,
            outcome: 'failed-retest',
            brokenAt: state.brokenAt ?? at,
            retestedAt: state.retestedAt,
            firedAt: at,
            volumeAboveAverage: state.volumeAboveAverage,
          }
        : null,
    };
  }

  /*
   * Still hanging around the level. The furthest point reached during the
   * retest is tracked, so the confirmation is measured against the actual
   * extreme rather than against whichever bar happened to touch first.
   */
  return {
    state: {
      ...next,
      retestExtreme:
        state.retestExtreme === null
          ? direction === 'down'
            ? bar.l
            : bar.h
          : direction === 'down'
            ? Math.min(state.retestExtreme, bar.l)
            : Math.max(state.retestExtreme, bar.h),
    },
    event: null,
  };
}

/**
 * Whether a level has moved far enough that its stored state is about a
 * different price and should be discarded.
 */
export function levelMovedAway(state: LevelState, price: number): boolean {
  if (state.price === 0) return true;
  return Math.abs(price - state.price) / Math.abs(state.price) > LEVEL_DRIFT_RESET_PCT;
}
