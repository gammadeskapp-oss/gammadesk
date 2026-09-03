import raw from './calendar.json';
import {
  eventsForRow,
  hasHighImportanceToday,
  sessionRules,
  type EventRow,
  type MarketCalendar,
  type SessionRules,
} from './rules';
import {
  assessDailySnapshot,
  assessStaleness,
  previousSessionDate,
  type Staleness,
} from '../staleness';
import { marketStatus, type MarketStatus } from '../marketPhase';
import { marketToday } from '../time';

/**
 * The loaded calendar, and the app-facing calls that use it.
 *
 * The JSON import lives here and nowhere else — see the note at the top of
 * `rules.ts` for why that separation is load-bearing rather than tidiness.
 *
 * No caching and no store: this is a file compiled into the bundle. It changes
 * when someone edits it and deploys, which is exactly the maintenance model
 * asked for.
 */

const calendar = raw as MarketCalendar;

export type { EventRow, Importance, MarketDay, ScheduledEvent } from './rules';
export type { MarketPhase, MarketStatus } from '../marketPhase';
export { EVENT_RISK_WARNING } from './rules';

/** The session lookups, built once. */
const rules: SessionRules = sessionRules(calendar);

export function marketSessionRules(): SessionRules {
  return rules;
}

/** Today's and tomorrow's scheduled events. */
export function eventRow(now: Date = new Date()): EventRow[] {
  return eventsForRow(calendar, marketToday(now));
}

/** True when something high-importance is scheduled for today. */
export function highImportanceToday(now: Date = new Date()): boolean {
  return hasHighImportanceToday(calendar, marketToday(now));
}

/**
 * Grade a snapshot against the market clock, holidays included.
 *
 * This is what pages should call. `assessStaleness` is still exported from
 * `staleness.ts` for the tests, which need to drive it with a synthetic
 * calendar — but a page reaching for it directly gets the no-calendar default
 * and would go back to calling Thanksgiving a broken feed.
 */
export function snapshotStaleness(
  isoTimestamp: string | null | undefined,
  now: Date = new Date(),
): Staleness {
  return assessStaleness(isoTimestamp, now, rules);
}

/** The once-a-day version, for the morning post. Same reasoning as above. */
export function dailySnapshotStaleness(
  snapshotDate: string | null | undefined,
  generatedAtIso: string | null | undefined,
  now: Date = new Date(),
): Staleness {
  return assessDailySnapshot(snapshotDate, generatedAtIso, now, rules);
}

/**
 * The trading day before `date`, holidays included. The calendar-aware wrapper
 * pages should call — the bare helper defaults to treating every weekday as a
 * session, which would point a comparison at Thanksgiving.
 */
export function priorSessionDate(date: string): string | null {
  return previousSessionDate(date, rules);
}

/**
 * Where the market clock is right now, holidays included.
 *
 * The calendar-aware wrapper pages should call. The bare helper defaults to
 * treating every weekday as a session, which on Thanksgiving would tell a
 * reader the market opens in an hour.
 */
export function currentMarketStatus(now: Date = new Date()): MarketStatus {
  return marketStatus(now, rules);
}
