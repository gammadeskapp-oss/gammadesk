/**
 * When each X post is allowed to fire, decided on the America/Chicago clock.
 *
 * ## Why Chicago and not New York
 *
 * The brief specifies the schedule in Central Time, and asks that DST changes
 * never shift a post. Both zones observe US DST on the same dates, so either
 * would keep the posts from drifting — but the times are stated in CT, so the
 * gate is read in CT and there is no offset arithmetic to get wrong.
 *
 * ## Why the gate is here and not in the cron line
 *
 * Vercel cron schedules are UTC, so a fixed UTC time lands an hour earlier or
 * later across a DST boundary — the same problem `lib/scanner/schedule.ts`
 * solves for the scan. Each cron entry is registered to cover the CT slot in
 * both summer and winter, and these pure functions decide, from the actual
 * Chicago clock, whether *this* firing is the intended one. A firing at the
 * wrong hour returns null and the route skips without spending anything.
 *
 * Pure functions over `now` and the session rules, so the whole schedule is
 * unit-tested in `scripts/verify-x-poster.mjs` without waiting for a clock.
 */

import type { PostSlot } from './types';

export const CHICAGO_TZ = 'America/Chicago';

const chicagoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CHICAGO_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The Chicago wall clock as a short label, e.g. `8:25 CT` — no leading zero on
 * the hour, matching how the morning post states its time.
 */
export function formatClockCt(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  let hour = Number(get('hour')) % 24;
  if (Number.isNaN(hour)) hour = 0;
  return `${hour}:${get('minute')} CT`;
}

export interface ChicagoClock {
  /** `YYYY-MM-DD` in Chicago. */
  date: string;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

/** The current Chicago wall clock, broken out for the schedule gates. */
export function chicagoNow(now: Date = new Date()): ChicagoClock {
  const parts = chicagoParts.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const [y, m, d] = date.split('-').map(Number);
  let hour = Number(get('hour')) % 24;
  // Intl renders midnight as "24" in some engines; normalise to 0.
  if (hour === 24) hour = 0;

  return {
    date,
    hour,
    minute: Number(get('minute')),
    weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
  };
}

/**
 * A minimal session-rules shape, so this file does not import the calendar
 * (which would drag the JSON into every test). The real rules come from
 * `lib/events`.
 */
export interface ClosedCheck {
  isClosed(date: string): boolean;
}

const NEVER_CLOSED: ClosedCheck = { isClosed: () => false };

/** Monday–Friday and not a calendar holiday. */
export function isTradingDay(
  date: string,
  rules: ClosedCheck = NEVER_CLOSED,
): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday < 1 || weekday > 5) return false;
  return !rules.isClosed(date);
}

/** The Chicago hour at which the morning post fires (8:25 AM CT). */
export const MORNING_HOUR_CT = 8;

/** The Chicago hour at which the daily gamma post fires. */
export const GAMMA_HOUR_CT = 8;

/** The Chicago hour at which the closing post fires (3:20 PM CT). */
export const CLOSING_HOUR_CT = 15;

/** First and last Chicago hours of the hourly market-pulse window (inclusive). */
export const PULSE_FIRST_HOUR_CT = 9;
export const PULSE_LAST_HOUR_CT = 14;

/** The Chicago hour at which the Sunday weekly-recap post fires (5:00 PM CT). */
export const WEEKLY_HOUR_CT = 17;

/** The Chicago hour at which the earnings-day post fires (7:30 AM CT). */
export const EARNINGS_HOUR_CT = 7;

/**
 * The most recent Friday on or before `now`, as a Chicago `YYYY-MM-DD`. On a
 * Sunday this is two days back — the Friday the just-ended week closed on, which
 * is the weekly brief's `weekEnding`.
 */
export function mostRecentFriday(now: Date = new Date()): string {
  const clock = chicagoNow(now);
  const [y, m, d] = clock.date.split('-').map(Number);
  const daysSinceFriday = (clock.weekday - 5 + 7) % 7; // Friday = 5
  const base = Date.UTC(y, m - 1, d) - daysSinceFriday * 86_400_000;
  const dt = new Date(base);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * The weekly slot if this firing is the 5:xx PM CT one on a Sunday, else null.
 * Gated on Sunday + the hour (17 CT); not tied to a trading day, since it fires
 * on the weekend and recaps the week that just closed.
 */
export function dueWeeklySlot(now: Date = new Date()): PostSlot | null {
  const clock = chicagoNow(now);
  if (clock.weekday !== 0) return null; // Sunday only
  if (clock.hour !== WEEKLY_HOUR_CT) return null;
  return { kind: 'weekly', key: 'weekly', label: 'Weekly recap (Sun 5:00 CT)' };
}

/**
 * The earnings slot if this firing is the 7:xx AM CT one on a trading day, else
 * null. Whether anything is actually posted then depends on who reports — the
 * composer skips silently when no well-known name is on the calendar.
 */
export function dueEarningsSlot(
  now: Date = new Date(),
  rules: ClosedCheck = NEVER_CLOSED,
): PostSlot | null {
  const clock = chicagoNow(now);
  if (!isTradingDay(clock.date, rules)) return null;
  if (clock.hour !== EARNINGS_HOUR_CT) return null;
  return { kind: 'earnings', key: 'earnings', label: 'Earnings today (7:30 CT)' };
}

/**
 * The morning slot if this firing is the 8:xx CT one on a trading day, else
 * null — the 8:25 CT snapshot that leads with the Cowork "Morning Desk" brief.
 *
 * Gated on the hour (8 CT) like gamma, so a cron delayed a few minutes still
 * posts and a firing pushed into the 9 o'clock hour is rejected. The morning
 * cron fires at :25 and the gamma cron at :30, so they never land on the same
 * firing even though both accept the 8 o'clock hour; the once-a-day ledger keys
 * ('morning' vs 'gamma') keep them independent.
 */
export function dueMorningSlot(
  now: Date = new Date(),
  rules: ClosedCheck = NEVER_CLOSED,
): PostSlot | null {
  const clock = chicagoNow(now);
  if (!isTradingDay(clock.date, rules)) return null;
  if (clock.hour !== MORNING_HOUR_CT) return null;
  return { kind: 'morning', key: 'morning', label: 'Morning snapshot (8:25 CT)' };
}

/**
 * The gamma slot if this firing is the 8:xx CT one on a trading day, else null.
 *
 * Gated on the hour rather than the exact minute so a cron delayed a few
 * minutes past 8:30 still posts; a firing pushed into the 9 o'clock hour is
 * rejected rather than posted under a misleading time, and the once-a-day
 * ledger stops a second 8:xx firing.
 */
export function dueGammaSlot(
  now: Date = new Date(),
  rules: ClosedCheck = NEVER_CLOSED,
): PostSlot | null {
  const clock = chicagoNow(now);
  if (!isTradingDay(clock.date, rules)) return null;
  if (clock.hour !== GAMMA_HOUR_CT) return null;
  return { kind: 'gamma', key: 'gamma', label: 'SPY daily gamma levels (8:30 CT)' };
}

/**
 * The closing slot if this firing is the 3:20 PM CT one on a trading day, else
 * null. Gated on the hour (15 CT) so a cron delayed a few minutes past 3:20
 * still posts; the once-a-day ledger stops a second firing in the same hour.
 */
export function dueClosingSlot(
  now: Date = new Date(),
  rules: ClosedCheck = NEVER_CLOSED,
): PostSlot | null {
  const clock = chicagoNow(now);
  if (!isTradingDay(clock.date, rules)) return null;
  if (clock.hour !== CLOSING_HOUR_CT) return null;
  return { kind: 'closing', key: 'closing', label: 'Closing snapshot (3:20 CT)' };
}

/**
 * The market-pulse slot for this firing, or null when outside the 9:30–2:30 CT
 * window (or not a trading day).
 *
 * The slot key carries the Chicago hour so the six firings a day are six
 * distinct ledger rows, each posted at most once.
 */
export function duePulseSlot(
  now: Date = new Date(),
  rules: ClosedCheck = NEVER_CLOSED,
): PostSlot | null {
  const clock = chicagoNow(now);
  if (!isTradingDay(clock.date, rules)) return null;
  if (clock.hour < PULSE_FIRST_HOUR_CT || clock.hour > PULSE_LAST_HOUR_CT) return null;
  const hh = String(clock.hour).padStart(2, '0');
  return {
    kind: 'pulse',
    key: `pulse-${hh}`,
    label: `Market pulse (${hh}:30 CT)`,
  };
}
