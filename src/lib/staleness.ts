import { NO_CALENDAR, REGULAR_CLOSE_HOUR, type SessionRules } from './events/rules';
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
 * ## Holidays and early closes
 *
 * Both come from the hand-maintained calendar in `events/calendar.json`, via
 * the `SessionRules` argument. A closed day is skipped when walking back for
 * the last completed session, and an early close moves that session's end to
 * 13:00 so an afternoon reader on Christmas Eve is not told the feed died.
 *
 * The rules are passed in rather than imported. That is not indirection for
 * its own sake — see the note at the top of `events/rules.ts`; a static JSON
 * import in this file takes the whole verification suite offline.
 *
 * Called without rules, this degrades to treating every weekday as a full
 * session, which is the behaviour it had before the calendar existed: a
 * holiday then reads as stale, which is a false alarm in the harmless
 * direction. Pages should call `snapshotStaleness` from `lib/events`, which
 * supplies the real calendar.
 */

/** Regular-hours session open, New York time. The close varies — see below. */
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;

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
  /** True when the calendar shortened this session. */
  earlyClose: boolean;
}

/**
 * The open and close of one named trading day.
 *
 * Exported for /movers, which needs the two edges to say how far through a
 * session a reading was taken. It does not check whether the date is a
 * trading day at all — callers that care must ask `rules.isClosed` first.
 */
export function sessionFor(date: string, rules: SessionRules): Session {
  const [y, m, d] = date.split('-').map(Number);
  return {
    date,
    openMs: marketTimeToUtcMs(y, m, d, OPEN_HOUR, OPEN_MINUTE),
    // An early-close day ends when the calendar says it does, not at 16:00.
    closeMs: marketTimeToUtcMs(
      y,
      m,
      d,
      rules.closeHour(date),
      rules.closeMinute(date),
    ),
    earlyClose: rules.closeHour(date) !== REGULAR_CLOSE_HOUR,
  };
}

/**
 * Add calendar days to a `YYYY-MM-DD`, staying in that format.
 *
 * Exported for `marketPhase.ts`, which walks the calendar forward to find the
 * next session the way this file walks it backward to find the last one.
 */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** True for Monday-Friday. Says nothing about holidays — ask the rules. */
export function isWeekday(date: string): boolean {
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
export function lastCompletedSession(
  now: Date = new Date(),
  rules: SessionRules = NO_CALENDAR,
): Session {
  const nowMs = now.getTime();
  let date = marketNow(now).date;

  for (let i = 0; i < 14; i += 1) {
    if (isWeekday(date) && !rules.isClosed(date)) {
      const session = sessionFor(date, rules);
      if (session.closeMs <= nowMs) return session;
    }
    date = addCalendarDays(date, -1);
  }

  // Unreachable with a sane clock; returning something beats throwing inside a
  // page render.
  return sessionFor(date, rules);
}

/**
 * The trading day before `date`, skipping weekends and calendar holidays.
 *
 * This exists because "the previous session" and "yesterday" are the same
 * thing only four days in five. Subtracting one calendar day lands on Sunday
 * every Monday, and any feature that compares today against it would go blank
 * once a week and look broken rather than careful.
 *
 * Walks back at most a fortnight, the same bound `lastCompletedSession` uses,
 * so a bad clock or a mis-entered calendar cannot spin here. Returns null if
 * it finds nothing in that window, which the caller must treat as "no
 * comparison available" rather than substituting a guess.
 */
export function previousSessionDate(
  date: string,
  rules: SessionRules = NO_CALENDAR,
): string | null {
  let cursor = addCalendarDays(date, -1);

  for (let i = 0; i < 14; i += 1) {
    if (isWeekday(cursor) && !rules.isClosed(cursor)) return cursor;
    cursor = addCalendarDays(cursor, -1);
  }

  return null;
}

/** True when `now` falls inside a trading session. */
export function inSession(
  now: Date = new Date(),
  rules: SessionRules = NO_CALENDAR,
): boolean {
  const { date } = marketNow(now);
  if (!isWeekday(date) || rules.isClosed(date)) return false;
  const session = sessionFor(date, rules);
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
  rules: SessionRules = NO_CALENDAR,
): Staleness {
  const session = lastCompletedSession(now, rules);
  const open = inSession(now, rules);
  const reference = open ? now.getTime() : session.closeMs;
  const expectedNote = open
    ? `The market is open, so the feed should be no more than ${TOLERANCE_MINUTES} minutes behind.`
    : `The last completed session, ${sessionLabel(session.date)}, closed at ${formatAsOf(new Date(session.closeMs))}${session.earlyClose ? ' — an early close' : ''}.`;

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
export function expectedDailyDate(
  now: Date = new Date(),
  rules: SessionRules = NO_CALENDAR,
): string {
  const { date } = marketNow(now);
  if (isWeekday(date) && !rules.isClosed(date)) {
    const [y, m, d] = date.split('-').map(Number);
    const postTime = marketTimeToUtcMs(y, m, d, OPEN_HOUR, 0);
    if (now.getTime() >= postTime) return date;
  }
  return lastCompletedSession(now, rules).date;
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
  rules: SessionRules = NO_CALENDAR,
): Staleness {
  const session = lastCompletedSession(now, rules);
  const expected = expectedDailyDate(now, rules);
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
