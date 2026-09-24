import type { DeskSnapshot } from './compose';
import { NEAR_PCT } from './phrases';
import { chicagoNow } from './schedule';

/**
 * The intraday cadence: a human-style update every 30–45 minutes through the
 * session, with a level-break post firing immediately regardless of the timer.
 *
 * The pure functions here decide *whether* this firing should post and *what*
 * gap comes next. The durable state (the next allowed time, and which level
 * breaks have already posted today) lives in `intradayStore.ts` — kept apart so
 * this module stays free of `server-only` and the whole cadence is unit-tested
 * in `scripts/verify-x-poster.mjs` without waiting for a clock.
 */

/** The intraday window, on the Chicago clock: 9:00 AM through 2:45 PM CT. */
export const INTRADAY_FIRST = { hour: 9, minute: 0 };
export const INTRADAY_LAST = { hour: 14, minute: 45 };

const GAP_MIN = 30;
const GAP_MAX = 45;

/** The day's flip/support/resistance, locked at the morning post. */
export interface LockedLevels {
  flip: number | null;
  support: number | null;
  resistance: number | null;
}

export interface IntradayState {
  /** Chicago `YYYY-MM-DD` this state describes. */
  date: string;
  /** When the next *timed* update may fire, ISO; null before the first post. */
  nextDueIso: string | null;
  /** Level-break keys already posted today. */
  triggersPosted: string[];
  /** Phrase-bank ids already posted today, so none repeats within the day. */
  usedPhrases: string[];
  /**
   * The flip/support/resistance the whole day's intraday posts measure against,
   * locked at the 8:30 morning post (or the first intraday post if the morning
   * one was missed). Levels are not recomputed per post, so a chain that
   * re-reads a slightly different flip mid-session does not move the goalposts
   * or re-fire an alert. Absent until the day's first post locks it.
   */
  lockedLevels?: LockedLevels;
  /** When a "wild/bigger moves" line last posted, ISO — throttles it to 1/hour. */
  lastWildIso?: string;
  /** True once the 4:30 CT daily summary email has gone out for this day. */
  summarySent?: boolean;
  /** When the "stale during market hours" alert last fired, ISO — throttles it. */
  staleAlertedAt?: string;
}

/**
 * Overlay the day's locked levels onto a live snapshot: the price and movers
 * stay live, the flip/support/resistance come from the lock. Used for every
 * intraday decision and post so the levels are the morning's, all day.
 */
export function applyLockedLevels(s: DeskSnapshot, locked: LockedLevels | null): DeskSnapshot {
  if (!locked) return s;
  return { ...s, flip: locked.flip, support: locked.support, resistance: locked.resistance };
}

/** The levels to lock from a snapshot at the day's first post. */
export function lockableLevels(s: DeskSnapshot): LockedLevels {
  return { flip: s.flip, support: s.support, resistance: s.resistance };
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/** True when the Chicago clock is inside the intraday window. */
export function inIntradayWindow(now: Date): boolean {
  const c = chicagoNow(now);
  const m = minutesOfDay(c.hour, c.minute);
  return (
    m >= minutesOfDay(INTRADAY_FIRST.hour, INTRADAY_FIRST.minute) &&
    m <= minutesOfDay(INTRADAY_LAST.hour, INTRADAY_LAST.minute)
  );
}

/** A random gap in [30, 45] minutes, so the spacing feels natural. */
export function randomGapMinutes(rand: () => number = Math.random): number {
  return GAP_MIN + Math.floor(rand() * (GAP_MAX - GAP_MIN + 1));
}

/** The next-due timestamp after a post at `now`, as an ISO string. */
export function nextDueAfter(now: Date, rand: () => number = Math.random): string {
  return new Date(now.getTime() + randomGapMinutes(rand) * 60_000).toISOString();
}

/**
 * Count how often each intraday phrase was used across recent posts, for the
 * self-varying selector. Pure over the log rows: only `sent` intraday rows with
 * a `phraseId` and an `at` at or after `sinceMs` count.
 */
export function phraseUsage(
  rows: Array<{ slot: string; outcome: string; at: string; phraseId?: string }>,
  sinceMs: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.slot !== 'intraday' || r.outcome !== 'sent' || !r.phraseId) continue;
    if (Date.parse(r.at) < sinceMs) continue;
    counts[r.phraseId] = (counts[r.phraseId] ?? 0) + 1;
  }
  return counts;
}

export type TriggerKey = 'below-flip' | 'above-resistance' | 'below-support';

/**
 * The one pending level break for this snapshot, or null. A break fires at most
 * once per level per day, so a key already in `posted` is skipped. Flip is
 * checked first, then a break above resistance, then below support.
 */
export function pendingTrigger(s: DeskSnapshot, posted: string[]): TriggerKey | null {
  // A cross counts only once price is at least NEAR_PCT (0.15%) past the level,
  // so a hair over the line is not an alert. Each key fires at most once a day
  // (it is then in `posted`), so a level re-crossed later does not re-alert.
  if (s.flip !== null && s.spot < s.flip * (1 - NEAR_PCT) && !posted.includes('below-flip')) return 'below-flip';
  if (s.resistance !== null && s.spot > s.resistance * (1 + NEAR_PCT) && !posted.includes('above-resistance')) {
    return 'above-resistance';
  }
  if (s.support !== null && s.spot < s.support * (1 - NEAR_PCT) && !posted.includes('below-support')) return 'below-support';
  return null;
}

export type IntradayDecision =
  | { post: false; reason: string }
  | { post: true; trigger: TriggerKey | null; slotKey: string };

/**
 * Should this firing post an intraday update?
 *
 * A pending level break posts immediately (its own ledger key). Otherwise a
 * timed update posts only inside the window and only once the random gap since
 * the last post has elapsed. Outside the window, nothing but a break fires.
 */
export function decideIntraday(
  s: DeskSnapshot,
  state: IntradayState,
  now: Date,
): IntradayDecision {
  const trigger = pendingTrigger(s, state.triggersPosted);
  if (trigger) {
    return { post: true, trigger, slotKey: `intraday-trigger-${trigger}` };
  }

  if (!inIntradayWindow(now)) {
    return { post: false, reason: 'Outside the 9:00–2:45 CT intraday window.' };
  }

  if (state.nextDueIso) {
    const due = Date.parse(state.nextDueIso);
    if (Number.isFinite(due) && now.getTime() < due) {
      return { post: false, reason: `Next timed update is not due until ${state.nextDueIso}.` };
    }
  }

  const c = chicagoNow(now);
  const slotKey = `intraday-${String(c.hour).padStart(2, '0')}${String(c.minute).padStart(2, '0')}`;
  return { post: true, trigger: null, slotKey };
}
