import { formatAsOf, marketNow, marketTimeToUtcMs } from './time';

/**
 * Is the snapshot on screen old enough that the levels should not be trusted?
 *
 * ## Why this is not simply "older than the last close"
 *
 * The obvious test — stale when the snapshot predates the last completed
 * session's close — is wrong for a third of the day. At 20:00 ET the last
 * completed session is today, its close was 16:00, and the newest snapshot
 * that will ever exist is the one taken just before that close. A literal test
 * flags correct end-of-day data as unavailable every single evening, and a
 * banner that cries wolf nightly is a banner nobody reads at 11:00 on a
 * Wednesday when it actually matters.
 *
 * So the reference point is "the most recent moment the feed should have had
 * something new to say":
 *
 *   - inside a session  -> now
 *   - outside a session -> the last completed session's close
 *
 * A snapshot older than that by more than `TOLERANCE_MINUTES` is stale. The
 * cases this gets right, which is the whole point:
 *
 *   Tue 11:00, snapshot Mon 15:00  -> stale     (feed is broken)
 *   Tue 11:00, snapshot Tue 09:45  -> fresh
 *   Tue 20:00, snapshot Tue 15:50  -> fresh     (correct end-of-day data)
 *   Tue 20:00, snapshot Mon 15:50  -> stale
 *   Tue 09:00, snapshot Mon 15:50  -> fresh     (nothing new exists yet)
 *   Sat 12:00, snapshot Fri 15:50  -> fresh
 *
 * ## Holidays are not modelled
 *
 * There is no holiday calendar in this codebase, so a weekday holiday is
 * treated as a trading day and data from the previous session reads as stale
 * once the fake session has been open longer than the tolerance. That is a
 * false alarm, and it errs toward "do not trade on these levels" on a day the
 * market is shut. Wrong in the harmless direction; noted rather than hidden.
 */

/** Regular-hours session bounds, New York time. */
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;
const CLOSE_HOUR = 16;

/**
 * How far behind the reference point a snapshot may sit and still count.
 *
 * The Cboe feed is delayed 15 minutes, results are cached for up to 30, and a
 * scheduled job can land a few minutes late. Ninety minutes clears all of that
 * with room to spare while still catching a feed that died at the open.
 */
export const TOLERANCE_MINUTES = 90;

export interface Session {
  /** `YYYY-MM-DD` in New York. */
  date: string;
  openMs: number;
  closeMs: number;
}

function sessionFor(date: string): Session {
  const [y, m, d] = date.split('-').map(Number);
  return {
    date,
    openMs: marketTimeToUtcMs(y, m, d, OPEN_HOUR, OPEN_MINUTE),
    closeMs: marketTimeToUtcMs(y, m, d, CLOSE_HOUR, 0),
  };
}

function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/**
 * The most recent session whose close has already passed.
 *
 * Walks back at most a fortnight, which is far more than any weekend needs and
 * bounded so a clock problem cannot spin here forever.
 */
export function lastCompletedSession(now: Date = new Date()): Session {
  const nowMs = now.getTime();
  let date = marketNow(now).date;

  for (let i = 0; i < 14; i += 1) {
    if (isWeekday(date)) {
      const session = sessionFor(date);
      if (session.closeMs <= nowMs) return session;
    }
    date = addCalendarDays(date, -1);
  }

  // Unreachable with a sane clock; returning something beats throwing inside a
  // page render.
  return sessionFor(date);
}

/** True when `now` falls inside a regular-hours weekday session. */
export function inSession(now: Date = new Date()): boolean {
  const { date } = marketNow(now);
  if (!isWeekday(date)) return false;
  const session = sessionFor(date);
  return now.getTime() >= session.openMs && now.getTime() <= session.closeMs;
}

export interface Staleness {
  /** Show the banner and mute the numbers. */
  stale: boolean;
  /** The snapshot's own timestamp, formatted for display, or null. */
  asOfLabel: string | null;
  /** Age of the snapshot in hours, one decimal. Null when there is none. */
  ageHours: number | null;
  /**
   * One finished sentence naming what the snapshot was measured against.
   *
   * A sentence rather than a bare timestamp because the two checks below
   * measure against different things — a moment on the clock in one case, a
   * whole session in the other — and the banner should not have to know which
   * kind of verdict it was handed in order to write a grammatical line.
   */
  expectedNote: string;
  /** The session the check used, for the /status page to name. */
  session: Session;
}

/**
 * Grade one snapshot timestamp.
 *
 * A missing or unparseable timestamp counts as stale: "we cannot tell how old
 * this is" and "this is old" deserve the same warning, and silently passing an
 * absent stamp is exactly the failure this guard exists to catch.
 */
export function assessStaleness(
  isoTimestamp: string | null | undefined,
  now: Date = new Date(),
): Staleness {
  const session = lastCompletedSession(now);
  const open = inSession(now);
  const reference = open ? now.getTime() : session.closeMs;
  const expectedNote = open
    ? `The market is open, so the feed should be no more than ${TOLERANCE_MINUTES} minutes behind.`
    : `The last completed session, ${sessionLabel(session.date)}, closed at ${formatAsOf(new Date(session.closeMs))}.`;

  const at = isoTimestamp ? Date.parse(isoTimestamp) : NaN;
  if (!Number.isFinite(at)) {
    return {
      stale: true,
      asOfLabel: null,
      ageHours: null,
      expectedNote,
      session,
    };
  }

  return {
    stale: at < reference - TOLERANCE_MINUTES * 60_000,
    asOfLabel: formatAsOf(new Date(at)),
    ageHours: Math.round(((now.getTime() - at) / 3_600_000) * 10) / 10,
    expectedNote,
    session,
  };
}

/**
 * The market date a once-a-day snapshot should be carrying right now.
 *
 * The morning post is generated at 09:00 ET and then does not change, so the
 * continuous check above is the wrong instrument for it: by 15:00 ET a
 * perfectly correct post is six hours old and would be condemned every
 * afternoon. What matters instead is *which session it describes*.
 *
 * Before 09:00 ET, or on a weekend, today's post does not exist yet and the
 * last completed session's is the newest there can be. From 09:00 ET on a
 * weekday, anything but today's is behind.
 */
export function expectedDailyDate(now: Date = new Date()): string {
  const { date } = marketNow(now);
  if (isWeekday(date)) {
    const [y, m, d] = date.split('-').map(Number);
    const postTime = marketTimeToUtcMs(y, m, d, OPEN_HOUR, 0);
    if (now.getTime() >= postTime) return date;
  }
  return lastCompletedSession(now).date;
}

/**
 * Grade a once-a-day snapshot by the session it describes.
 *
 * Returns the same shape as `assessStaleness` so pages and the banner do not
 * need to know which of the two checks produced the verdict.
 */
export function assessDailySnapshot(
  snapshotDate: string | null | undefined,
  generatedAtIso: string | null | undefined,
  now: Date = new Date(),
): Staleness {
  const session = lastCompletedSession(now);
  const expected = expectedDailyDate(now);
  const at = generatedAtIso ? Date.parse(generatedAtIso) : NaN;

  return {
    stale: !snapshotDate || snapshotDate < expected,
    asOfLabel: Number.isFinite(at) ? formatAsOf(new Date(at)) : null,
    ageHours: ageHours(generatedAtIso, now),
    expectedNote: `This page should be showing the ${sessionLabel(expected)} session.`,
    session,
  };
}

/** Whole hours since an ISO timestamp, one decimal. Null when absent. */
export function ageHours(
  isoTimestamp: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const at = isoTimestamp ? Date.parse(isoTimestamp) : NaN;
  if (!Number.isFinite(at)) return null;
  return Math.round(((now.getTime() - at) / 3_600_000) * 10) / 10;
}

/** `2026-08-28` -> `Fri 28 Aug`, for naming a session in prose. */
export function sessionLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(parsed);
}
