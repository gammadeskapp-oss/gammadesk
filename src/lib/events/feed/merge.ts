/**
 * Merging the fetched Fed/Treasury events into the hand-maintained calendar.
 *
 * Pure and IO-free (see the note in `types.ts`): the server reader in
 * `../index.ts` loads the bundled `calendar.json` and the fetched store, hands
 * both to `mergeEvents`, and feeds the result straight into the existing
 * `eventsForRow` / `eventsInRange` / `hasHighImportanceToday` — so the fetched
 * events light up every surface that already reads the calendar, with no
 * second code path.
 */

import type { ScheduledEvent } from '../rules';

/** A date+name key for dedupe, insensitive to case and surrounding space. */
function eventKey(e: ScheduledEvent): string {
  return `${e.date}::${e.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Whether `a` should win over `b` when the two collide on date+name.
 *
 * A fetched event (it carries a `sourceUrl`) beats a hand-maintained guess: it
 * was read off the official page this run, so it has the real time, the CT
 * clock and the "who". Between two of the same kind, a confirmed entry beats an
 * unconfirmed one, and otherwise the incumbent stays — merging is stable.
 */
function prefer(a: ScheduledEvent, b: ScheduledEvent): boolean {
  const aFetched = Boolean(a.sourceUrl);
  const bFetched = Boolean(b.sourceUrl);
  if (aFetched !== bFetched) return aFetched;
  if (a.confirmed !== b.confirmed) return a.confirmed;
  return false;
}

/**
 * Merge two event lists into one, de-duplicated by date+name and sorted by
 * date then time. `bundled` is the hand-maintained calendar (CPI, jobs, the
 * published FOMC dates, …); `fetched` is this run's Fed Board + Treasury pull.
 *
 * Neither list is required — a failed fetch passes `[]` and the bundled
 * calendar shows through unchanged, which is the whole point of keeping both.
 */
export function mergeEvents(
  bundled: ScheduledEvent[],
  fetched: ScheduledEvent[],
): ScheduledEvent[] {
  const byKey = new Map<string, ScheduledEvent>();

  for (const e of [...bundled, ...fetched]) {
    const key = eventKey(e);
    const existing = byKey.get(key);
    if (!existing || prefer(e, existing)) byKey.set(key, e);
  }

  return [...byKey.values()].sort((a, b) =>
    a.date === b.date ? a.timeEt.localeCompare(b.timeEt) : a.date.localeCompare(b.date),
  );
}

/**
 * Keep only events on or between two `YYYY-MM-DD` dates, inclusive. Used to
 * trim a fetch to the next-seven-days window before it is stored. Lexical, so
 * it needs no date parsing.
 */
export function eventsWithin(
  events: ScheduledEvent[],
  fromDate: string,
  toDate: string,
): ScheduledEvent[] {
  return events.filter((e) => e.date >= fromDate && e.date <= toDate);
}

/** `YYYY-MM-DD` `days` after `date`. Pure, UTC-based so there is no TZ drift. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
