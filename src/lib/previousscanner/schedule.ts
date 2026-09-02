import 'server-only';

import { marketNow } from '../time';

/**
 * Keeping two ET-precise jobs on a UTC-only scheduler.
 *
 * Vercel cron schedules are UTC and New York is not, so no single entry is
 * "09:35 ET" all year — the same line lands at 09:35 in summer and 08:35 in
 * winter. The existing jobs in this project absorb that by being scheduled
 * where an hour of drift does not matter (see DEPLOY.md). These two have no
 * such slack: 08:30 is chosen because open interest has just published, and
 * 09:35 is chosen because it is five minutes after the open. An hour early
 * makes both meaningless — the winter drift would run the scan before the
 * market had opened at all.
 *
 * So `vercel.json` registers *both* candidate UTC times for each job and each
 * one carries `?when=scheduled`. This guard then lets exactly one of them
 * through: the one where the New York wall clock actually reads the configured
 * time. The other fires, finds it is the wrong hour, and returns without
 * spending a single upstream request.
 *
 * A run delayed past the tolerance is refused rather than run late. Vercel's
 * free plan can delay a cron by up to an hour, and a scan that ran at 10:30
 * but published under a 09:35 heading would be a false statement about when
 * those VWAP readings were taken. Refusing is recoverable; a mislabelled list
 * is not.
 *
 * Manual invocations omit `when=scheduled` and are never blocked, which is how
 * a missed morning gets re-run deliberately.
 */

/** Minutes either side of the configured time a scheduled run is accepted. */
export const SCHEDULE_TOLERANCE_MINUTES = 20;

/** `HH:MM` to minutes past midnight, or null when it is not a time. */
function parseHhMm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Minutes past midnight, New York time. */
export function minutesEtNow(now: Date = new Date()): number {
  const clock = marketNow(now);
  return clock.hour * 60 + clock.minute;
}

export interface ScheduleCheck {
  /** Whether the job should run. */
  due: boolean;
  /** Current New York wall clock, `HH:MM`. */
  nowEt: string;
  /** How far from the configured time we are, in minutes. */
  driftMinutes: number;
}

export function checkSchedule(
  configuredEt: string,
  now: Date = new Date(),
): ScheduleCheck {
  const clock = marketNow(now);
  const nowEt = `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;

  const target = parseHhMm(configuredEt);
  const current = clock.hour * 60 + clock.minute;

  // An unparseable configured time must not silently disable the job — that
  // would be a typo in an env var quietly turning the scanner off.
  if (target === null) return { due: true, nowEt, driftMinutes: 0 };

  const drift = current - target;
  return {
    due: Math.abs(drift) <= SCHEDULE_TOLERANCE_MINUTES,
    nowEt,
    driftMinutes: drift,
  };
}

/** New York wall clock of an instant, as `HH:MM`. */
export function formatEtClock(at: Date): string {
  const clock = marketNow(at);
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
}
