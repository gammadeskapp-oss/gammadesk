/**
 * The scheduled-events calendar, as logic rather than as data.
 *
 * ## Why the JSON is not imported here
 *
 * Everything in this file takes the calendar as an argument. That looks like
 * ceremony and is not: `staleness.ts` needs the market-closed dates, and it is
 * exercised by `verify:staleness`, which runs the TypeScript through Node's
 * type-stripping loader. That loader cannot import a `.json` module without an
 * import attribute TypeScript does not emit — so a static `import calendar
 * from './calendar.json'` anywhere in this dependency chain takes the whole
 * verification suite offline.
 *
 * Passing the calendar in also means the tests can hand these functions a
 * three-line calendar and check the holiday behaviour exactly, rather than
 * asserting against whatever real dates happen to be checked in this month.
 *
 * `index.ts` is where the JSON is loaded and where app code should import
 * from.
 */

export type Importance = 'high' | 'medium' | 'low';
export type MarketDayStatus = 'closed' | 'early-close';

export interface ScheduledEvent {
  /** `YYYY-MM-DD`, New York. */
  date: string;
  /** New York wall clock, 24-hour, e.g. `08:30`. */
  timeEt: string;
  name: string;
  importance: Importance;
  /**
   * False when the date was derived from a pattern rather than read off an
   * official calendar.
   *
   * Carried through to the screen rather than kept as a maintenance note. A
   * reader deciding whether to trust today's levels is entitled to know that
   * the CPI print the warning refers to is our guess at the date.
   */
  confirmed: boolean;
}

export interface MarketDay {
  date: string;
  status: MarketDayStatus;
  /** New York wall clock the session ends, for an early close. */
  closeEt?: string;
  name: string;
  confirmed: boolean;
}

export interface MarketCalendar {
  events: ScheduledEvent[];
  marketCalendar: MarketDay[];
}

/**
 * The two lookups `staleness.ts` needs, and nothing else.
 *
 * A narrow shape on purpose: the staleness guard has no business knowing that
 * CPI exists, and giving it the whole calendar would let a later edit reach
 * for the events list from inside a freshness check.
 */
export interface SessionRules {
  /** True when the market does not open at all that day. */
  isClosed(date: string): boolean;
  /** Session end in New York hours, e.g. 16 or 13. */
  closeHour(date: string): number;
  /** Minute of the session end, for a 13:00 or 16:00 close. */
  closeMinute(date: string): number;
}

/** The regular close, when nothing in the calendar says otherwise. */
export const REGULAR_CLOSE_HOUR = 16;

/**
 * Rules with no calendar behind them: every weekday is a full session.
 *
 * This is the behaviour the staleness guard had before the calendar existed,
 * kept as the default so the guard degrades to "slightly over-cautious on
 * holidays" rather than to "throws" if it is ever called without one.
 */
export const NO_CALENDAR: SessionRules = {
  isClosed: () => false,
  closeHour: () => REGULAR_CLOSE_HOUR,
  closeMinute: () => 0,
};

/** Build the session lookups from a calendar. */
export function sessionRules(calendar: MarketCalendar): SessionRules {
  const byDate = new Map(calendar.marketCalendar.map((d) => [d.date, d]));

  return {
    isClosed: (date) => byDate.get(date)?.status === 'closed',
    closeHour: (date) => {
      const day = byDate.get(date);
      if (day?.status !== 'early-close' || !day.closeEt) return REGULAR_CLOSE_HOUR;
      const hour = Number(day.closeEt.split(':')[0]);
      return Number.isFinite(hour) ? hour : REGULAR_CLOSE_HOUR;
    },
    closeMinute: (date) => {
      const day = byDate.get(date);
      if (day?.status !== 'early-close' || !day.closeEt) return 0;
      const minute = Number(day.closeEt.split(':')[1]);
      return Number.isFinite(minute) ? minute : 0;
    },
  };
}

/** Add calendar days to a `YYYY-MM-DD` string. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface EventRow extends ScheduledEvent {
  /** `today` or `tomorrow`, for the row's grouping label. */
  when: 'today' | 'tomorrow';
}

/**
 * Today's and tomorrow's events, in time order within each day.
 *
 * Tomorrow is the next calendar day, not the next trading day. An 08:30 print
 * on a Saturday does not exist, but a Sunday-evening reader looking at Monday
 * is the case this row is for, and the calendar simply has no weekend entries
 * to produce a wrong answer from.
 */
export function eventsForRow(
  calendar: MarketCalendar,
  todayDate: string,
): EventRow[] {
  const tomorrowDate = shiftDate(todayDate, 1);

  return calendar.events
    .filter((e) => e.date === todayDate || e.date === tomorrowDate)
    .map((e) => ({ ...e, when: e.date === todayDate ? 'today' : 'tomorrow' }) as EventRow)
    .sort((a, b) =>
      a.date === b.date ? a.timeEt.localeCompare(b.timeEt) : a.date.localeCompare(b.date),
    );
}

/** True when something high-importance is scheduled for today. */
export function hasHighImportanceToday(
  calendar: MarketCalendar,
  todayDate: string,
): boolean {
  return calendar.events.some(
    (e) => e.date === todayDate && e.importance === 'high',
  );
}

/** The line shown when it does. Fixed wording, one place. */
export const EVENT_RISK_WARNING =
  'Dealer-positioning levels are less reliable around scheduled news.';

/**
 * Structural check on a hand-maintained file.
 *
 * It is hand-maintained, which means the realistic failure is a typo in a date
 * or an importance nobody handles — not a corrupted download. Returning the
 * problems rather than throwing lets `verify:events` print all of them at once
 * instead of one per run.
 */
export function validateCalendar(raw: unknown): string[] {
  const problems: string[] = [];
  const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isTime = (v: unknown) =>
    typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

  if (!raw || typeof raw !== 'object') return ['Calendar is not an object.'];
  const doc = raw as Partial<MarketCalendar>;

  if (!Array.isArray(doc.events)) problems.push('`events` is missing or not an array.');
  if (!Array.isArray(doc.marketCalendar)) {
    problems.push('`marketCalendar` is missing or not an array.');
  }

  for (const [i, e] of (doc.events ?? []).entries()) {
    const at = `events[${i}] (${e?.name ?? 'unnamed'})`;
    if (!isDate(e?.date)) problems.push(`${at}: date must be YYYY-MM-DD.`);
    if (!isTime(e?.timeEt)) problems.push(`${at}: timeEt must be HH:MM.`);
    if (!e?.name) problems.push(`${at}: name is required.`);
    if (!['high', 'medium', 'low'].includes(e?.importance as string)) {
      problems.push(`${at}: importance must be high, medium or low.`);
    }
    if (typeof e?.confirmed !== 'boolean') {
      problems.push(`${at}: confirmed must be true or false, never absent.`);
    }
  }

  for (const [i, d] of (doc.marketCalendar ?? []).entries()) {
    const at = `marketCalendar[${i}] (${d?.name ?? 'unnamed'})`;
    if (!isDate(d?.date)) problems.push(`${at}: date must be YYYY-MM-DD.`);
    if (!['closed', 'early-close'].includes(d?.status as string)) {
      problems.push(`${at}: status must be closed or early-close.`);
    }
    if (d?.status === 'early-close' && !isTime(d?.closeEt)) {
      problems.push(`${at}: an early close needs closeEt as HH:MM.`);
    }
    if (typeof d?.confirmed !== 'boolean') {
      problems.push(`${at}: confirmed must be true or false, never absent.`);
    }
  }

  return problems;
}
