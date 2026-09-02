import type { SessionRules } from './events/rules';
import { inSession, lastCompletedSession } from './staleness';
import { marketNow, marketTimeToUtcMs } from './time';

/**
 * When a scheduled job was last *supposed* to have written.
 *
 * ## Why a flat age limit is not enough
 *
 * `cronHealth` grades every job against a flat `staleAfterHours`, tuned loose
 * enough (72h) to survive a long weekend. That is right for a status page and
 * useless for an alarm: at the Monday open every after-close job is 63 hours
 * old and perfectly healthy, so any threshold tight enough to catch a real
 * miss fires every Monday morning. An alarm that cries wolf weekly is an alarm
 * that gets muted, which is worse than no alarm at all.
 *
 * So the alarm measures against the last instant the job was due rather than
 * against the clock. Holidays and early closes fall out of it for free,
 * because the trading-day walk uses the same `SessionRules` the staleness
 * banner does — one calendar, not two.
 *
 * ## Why this file has no `server-only`
 *
 * The rest of the alarm reads from Blob storage and cannot run outside a
 * request. This part is pure arithmetic over a clock and a calendar, and it is
 * the part with all the edge cases — daylight saving, weekends, holidays, a
 * job that has not come due yet. Keeping it importable is what lets
 * `scripts/verify-cron-alarm.mjs` drive it at synthetic instants rather than
 * waiting for a Monday in November to find out whether it is right.
 */

/** How a job's schedule repeats. */
export type Due =
  /** Writes throughout the session, e.g. every minute. */
  | { kind: 'continuous' }
  /** Writes once per trading day at this New York wall-clock time. */
  | { kind: 'daily'; atEt: string }
  /** Writes once a week, on this weekday (0 = Sunday), at this ET time. */
  | { kind: 'weekly'; weekday: number; atEt: string };

/** Shift a `YYYY-MM-DD` by whole days. */
function stepDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd >= 1 && wd <= 5;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parseHhMm(value: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return [hour, minute];
}

/**
 * The most recent instant this job should already have written by, in epoch
 * milliseconds, grace included. Null when it has not come due yet within the
 * search window — which counts as healthy, not late.
 *
 * Both walks are bounded, on the same reasoning as `lastCompletedSession`: a
 * bad clock or a mis-entered calendar must not be able to spin here.
 *
 * An unparseable `atEt` returns null rather than defaulting to midnight. A
 * typo in a schedule should make the alarm quiet about that job, not make it
 * declare the job late every hour of every day — the noisy failure is the one
 * that gets the whole channel muted.
 */
export function lastDueInstant(
  due: Due,
  graceMinutes: number,
  now: Date,
  rules: SessionRules,
): number | null {
  const nowMs = now.getTime();
  const graceMs = graceMinutes * 60_000;

  if (due.kind === 'continuous') {
    /*
     * Inside a session the job should be writing right now, so the reference
     * is the present less its grace. Outside one, the newest sample that will
     * ever exist is the one taken at the last close — the same reasoning the
     * staleness banner uses, and for the same reason: measuring against `now`
     * after hours condemns correct end-of-day data every evening.
     */
    return inSession(now, rules)
      ? nowMs - graceMs
      : lastCompletedSession(now, rules).closeMs;
  }

  const parsed = parseHhMm(due.atEt);
  if (parsed === null) return null;
  const [hh, mm] = parsed;

  let date = marketNow(now).date;
  const limit = due.kind === 'weekly' ? 21 : 14;

  for (let i = 0; i < limit; i += 1) {
    const eligible =
      due.kind === 'weekly'
        ? weekdayOf(date) === due.weekday
        : isWeekday(date) && !rules.isClosed(date);

    if (eligible) {
      const [y, m, d] = date.split('-').map(Number);
      /*
       * Resolved through `marketTimeToUtcMs`, which settles the offset from
       * the IANA database rather than assuming -4 or -5. This is the line the
       * whole daylight-saving problem turns on: "09:00 ET" is a different UTC
       * instant in March than in December, and a job graded against the wrong
       * one is reported late for an hour twice a year.
       */
      const at = marketTimeToUtcMs(y, m, d, hh, mm);
      if (at + graceMs <= nowMs) return at;
    }
    date = stepDays(date, -1);
  }

  return null;
}

/** `HH:MM` on the New York clock, for prose. */
function tidyEt(atEt: string): string {
  const parsed = parseHhMm(atEt);
  if (parsed === null) return atEt;
  const [h, m] = parsed;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * The schedule in words, for /status to print beside the verdict.
 *
 * This is the descriptor the alarm actually grades against, not the cron
 * expression. The two can disagree — a job registered at two UTC times is one
 * daily job — and when someone is looking at a row that says LATE, the useful
 * question is "when should it have written", not "what is in vercel.json".
 */
export function describeDue(due: Due): string {
  switch (due.kind) {
    case 'continuous':
      return 'continuously while the market is open';
    case 'daily':
      return `every trading day at ${tidyEt(due.atEt)} ET`;
    case 'weekly':
      return `every ${WEEKDAY_NAMES[due.weekday] ?? `weekday ${due.weekday}`} at ${tidyEt(due.atEt)} ET`;
  }
}
