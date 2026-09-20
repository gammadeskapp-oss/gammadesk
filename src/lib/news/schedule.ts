/**
 * When the news scan is allowed to run — decided on the America/Chicago clock,
 * so a DST change never shifts the window.
 *
 * The brief asks for a scan every 15 minutes, 6:00 AM to 3:30 PM CT, on trading
 * days. Vercel cron schedules are UTC, so the cron line is registered to cover
 * that CT window in both summer and winter and this pure gate decides, from the
 * real Chicago wall clock, whether *this* firing is inside the window. A firing
 * outside it returns `false` and the route skips without spending anything.
 *
 * Pure — reuses the X poster's Chicago clock helper — so it is unit-tested in
 * `scripts/verify-news.mjs` without waiting for a real clock.
 */

import { chicagoNow, type ChicagoClock } from '../x/schedule';

/** Inclusive window bounds, in minutes past midnight CT. */
export const WINDOW_START_MIN = 6 * 60; // 06:00
export const WINDOW_END_MIN = 15 * 60 + 30; // 15:30

export interface WindowDecision {
  /** True when now is a trading day and inside the 06:00–15:30 CT window. */
  open: boolean;
  /** A short reason when closed, for the route to log. */
  reason: string;
  /** The Chicago clock the decision was made on. */
  clock: ChicagoClock;
}

/** Is `clock` a weekday (Mon–Fri)? Holidays are not modelled — a scan on a */
/** closed holiday simply finds no fresh filings and stores an empty day. */
function isTradingWeekday(clock: ChicagoClock): boolean {
  return clock.weekday >= 1 && clock.weekday <= 5;
}

/** Decide whether the scan window is open right now (Chicago time). */
export function scanWindow(now: Date = new Date()): WindowDecision {
  const clock = chicagoNow(now);
  if (!isTradingWeekday(clock)) {
    return { open: false, reason: 'Not a trading day (weekend).', clock };
  }
  const minutes = clock.hour * 60 + clock.minute;
  if (minutes < WINDOW_START_MIN || minutes > WINDOW_END_MIN) {
    return {
      open: false,
      reason: `Outside the 06:00–15:30 CT scan window (it is ${pad(clock.hour)}:${pad(clock.minute)} CT).`,
      clock,
    };
  }
  return { open: true, reason: 'Inside the scan window.', clock };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
