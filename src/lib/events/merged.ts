import 'server-only';

import raw from './calendar.json';
import {
  eventsForRow,
  eventsInRange,
  hasHighImportanceToday,
  type EventRow,
  type MarketCalendar,
  type ScheduledEvent,
} from './rules';
import { marketToday } from '../time';
import { allFeedEvents, readFeedDoc } from './feed/store';
import { mergeEvents } from './feed/merge';

/**
 * The calendar as every surface should read it now: the hand-maintained
 * `calendar.json` (CPI, jobs, published FOMC dates, holidays) merged with the
 * fetched Fed Board + Treasury events from the store.
 *
 * These are the async counterparts to the synchronous `eventRow` /
 * `eventsBetween` / `highImportanceToday` in `index.ts`. The sync ones stay for
 * the staleness guard, which only needs the market-closed dates and must not
 * take on an async store read. Everything that answers "what is on the calendar
 * for the reader" should call these.
 *
 * Server-only because it reads the Blob store; `index.ts` stays free of that so
 * it remains safe to import for types anywhere. A dead store degrades to the
 * bundled calendar alone — `readFeedDoc` swallows its own errors.
 */

const calendar = raw as MarketCalendar;

async function mergedCalendar(): Promise<MarketCalendar> {
  const doc = await readFeedDoc();
  return {
    events: mergeEvents(calendar.events, allFeedEvents(doc)),
    marketCalendar: calendar.marketCalendar,
  };
}

/** Today's and tomorrow's events, bundled + fetched, in time order. */
export async function mergedEventRow(now: Date = new Date()): Promise<EventRow[]> {
  return eventsForRow(await mergedCalendar(), marketToday(now));
}

/** Just today's events (the dashboard "Today's events" list). */
export async function todaysMergedEvents(now: Date = new Date()): Promise<EventRow[]> {
  return (await mergedEventRow(now)).filter((e) => e.when === 'today');
}

/** True when something high-importance is on today, bundled + fetched. */
export async function mergedHighImportanceToday(now: Date = new Date()): Promise<boolean> {
  return hasHighImportanceToday(await mergedCalendar(), marketToday(now));
}

/** Events on or between two `YYYY-MM-DD` dates, inclusive, bundled + fetched. */
export async function mergedEventsBetween(
  fromDate: string,
  toDate: string,
): Promise<ScheduledEvent[]> {
  return eventsInRange(await mergedCalendar(), fromDate, toDate);
}
