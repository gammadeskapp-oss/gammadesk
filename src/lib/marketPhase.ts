import { NO_CALENDAR, type SessionRules } from './events/rules';
import {
  addCalendarDays,
  inSession,
  isWeekday,
  lastCompletedSession,
  sessionFor,
  sessionLabel,
  type Session,
} from './staleness';
import { formatClockEt, marketNow } from './time';

/**
 * Where the clock is, and what a reader should be told because of it.
 *
 * ## Why this is separate from the stale-data guard
 *
 * `staleness.ts` answers one question — is this snapshot too old to trust —
 * and answers it with a red banner. That is a fault report, and it is silent
 * for the two-thirds of the week when nothing is wrong: at 07:00 on a Tuesday
 * and all day Saturday the newest data that exists is Friday's close, the
 * guard correctly says nothing, and the page renders yesterday's numbers with
 * no indication that they are yesterday's.
 *
 * To a returning user that reads as fine. To a first-time visitor arriving at
 * 22:00 it reads as broken: prices that do not move, cards showing a dash, no
 * hint that the market has been shut for six hours. The fix is not a louder
 * warning — it is the ordinary explanation the site was never giving. This
 * module produces that explanation, and it produces it in every phase,
 * including the ones the staleness guard is deliberately quiet in.
 *
 * The two must not be confused on screen either. The stale banner is red and
 * says do not trade off this. The session notice is grey and says this is
 * last session's close, which is exactly what it should be right now. Nothing
 * here reads any of the guard's thresholds, and nothing here can change what
 * it decides.
 */

export type MarketPhase =
  /** Inside a regular session. */
  | 'open'
  /** A trading day, before 09:30 ET. */
  | 'pre-open'
  /** A trading day, after the close. */
  | 'after-close'
  /** A weekend or a calendar holiday. */
  | 'closed-day';

export interface MarketStatus {
  phase: MarketPhase;
  /** Convenience for the common branch: true only in `open`. */
  open: boolean;
  /**
   * The session whose numbers the site is showing.
   *
   * In every closed phase this is the last completed session, which is the
   * honest answer to "what am I looking at". While open it is the previous
   * session, since intraday figures are their own thing and the pages that
   * show them label them themselves.
   */
  lastSession: Session;
  /** The next session that will produce new numbers. */
  nextSession: Session;
  /**
   * One short sentence naming what is on screen. Empty while open — there is
   * nothing to explain when the numbers are live.
   */
  showingLine: string;
  /** One short sentence saying when the numbers change again. Empty while open. */
  nextUpdateLine: string;
}

/**
 * The next session that has not finished yet.
 *
 * Walks forward at most a fortnight, mirroring the backward walk in
 * `staleness.ts`: long enough for a weekend plus the longest holiday cluster
 * on the calendar, bounded so a bad clock cannot spin here inside a render.
 */
export function nextSession(
  now: Date = new Date(),
  rules: SessionRules = NO_CALENDAR,
): Session {
  const nowMs = now.getTime();
  let date = marketNow(now).date;

  for (let i = 0; i < 14; i += 1) {
    if (isWeekday(date) && !rules.isClosed(date)) {
      const session = sessionFor(date, rules);
      if (session.closeMs > nowMs) return session;
    }
    date = addCalendarDays(date, 1);
  }

  return sessionFor(date, rules);
}

/**
 * How to name a session date in a sentence.
 *
 * `today` when it is today, because "Showing the Tue 25 Aug close" at 20:00 on
 * Tuesday describes the session the reader just watched as though it were an
 * archive. `possessive` shapes it for "…'s close" rather than "the … close",
 * which is the difference between "today's close" and "the today close".
 */
function dayPhrase(date: string, todayDate: string): string {
  return date === todayDate ? "today's" : `${sessionLabel(date)}'s`;
}

/**
 * Read the market clock and write the two sentences a closed page needs.
 *
 * The wording is deliberately plain and deliberately unalarmed. "The market is
 * closed" is not a failure, and a reader who has never used the site should be
 * able to tell the difference between that and the red banner without knowing
 * anything about how the data is collected.
 */
export function marketStatus(
  now: Date = new Date(),
  rules: SessionRules = NO_CALENDAR,
): MarketStatus {
  const today = marketNow(now).date;
  const open = inSession(now, rules);
  const last = lastCompletedSession(now, rules);
  const next = nextSession(now, rules);

  if (open) {
    return {
      phase: 'open',
      open: true,
      lastSession: last,
      nextSession: next,
      showingLine: '',
      nextUpdateLine: '',
    };
  }

  const tradingDayToday = isWeekday(today) && !rules.isClosed(today);
  const session = tradingDayToday ? sessionFor(today, rules) : null;
  const phase: MarketPhase =
    session && now.getTime() < session.openMs
      ? 'pre-open'
      : tradingDayToday
        ? 'after-close'
        : 'closed-day';

  /*
   * Whose close is on screen. After today's close that is today — saying
   * "last session" there would be technically true and actively misleading,
   * since the reader is looking at the session they just watched.
   */
  const showing = `Showing ${dayPhrase(last.date, today)} close${
    last.earlyClose ? ' — an early close' : ''
  }, ${formatClockEt(new Date(last.closeMs))}.`;

  const opensAt = `${
    next.date === today ? 'today' : sessionLabel(next.date)
  } at ${formatClockEt(new Date(next.openMs))}`;

  const lead =
    phase === 'pre-open'
      ? 'The market has not opened yet.'
      : 'The market is closed.';

  return {
    phase,
    open: false,
    lastSession: last,
    nextSession: next,
    showingLine: `${lead} ${showing}`,
    nextUpdateLine: `These numbers start moving again when it opens ${opensAt}.`,
  };
}
