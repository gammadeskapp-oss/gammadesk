/**
 * The scheduled-events wording for the X posts — pure, so `verify:fed-events`
 * checks it directly.
 *
 *   - `morningEventsLine`  the one line the morning post carries when something
 *     high/medium is on the calendar today ("📅 Today: …").
 *   - `dueEventHeadsUp`    the intraday decision: is a high/medium event about
 *     to start, not already flagged, and under the day's cap?
 *
 * Context only. Like everything on the events side, this states times and names
 * and never a direction.
 */

import type { Importance, ScheduledEvent } from '../events/rules';

/** Minutes past midnight for an `HH:MM` wall clock, or null. */
function toMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `13:00` → `1:00 PM`, `09:15` → `9:15 AM`. Falls back to the input. */
export function to12h(hhmm: string): string {
  const mins = toMinutes(hhmm);
  if (mins === null) return hhmm;
  const h24 = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, '0');
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${period}`;
}

/** The CT clock for an event, in 12-hour form (prefers the stored CT). */
function ctLabel(e: ScheduledEvent): string {
  return to12h(e.timeCt ?? e.timeEt);
}

const RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** Today's high/medium events, soonest first. */
function notableToday(events: ScheduledEvent[], today: string): ScheduledEvent[] {
  return events
    .filter((e) => e.date === today && (e.importance === 'high' || e.importance === 'medium'))
    .sort((a, b) => a.timeEt.localeCompare(b.timeEt));
}

/**
 * The morning post's events line, or null when nothing high/medium is on today.
 * Names up to two by time (CT), most important first, and counts the rest.
 */
export function morningEventsLine(events: ScheduledEvent[], today: string): string | null {
  const notable = notableToday(events, today);
  if (notable.length === 0) return null;

  // Lead with importance, then time, for which two to name.
  const ranked = [...notable].sort(
    (a, b) => RANK[a.importance] - RANK[b.importance] || a.timeEt.localeCompare(b.timeEt),
  );
  const named = ranked.slice(0, 2).map((e) => `${e.name} ${ctLabel(e)} CT`);
  const extra = ranked.length - named.length;
  const tail = extra > 0 ? ` · +${extra} more` : '';
  return `📅 Today: ${named.join(' · ')}${tail}`;
}

/** A stable per-event key for the once-per-event heads-up ledger. */
export function eventHeadsUpKey(e: ScheduledEvent): string {
  return `event-${e.date}-${e.timeEt}-${e.name.trim().toLowerCase().replace(/\s+/g, '-')}`;
}

export interface HeadsUpDecision {
  event: ScheduledEvent;
  key: string;
  minutesUntil: number;
}

/**
 * Whether a high/medium event is close enough to flag now.
 *
 * Fires for an event starting within `leadMin` minutes (default 15) and not
 * already past, that has not been flagged yet today, while the day is under the
 * `maxPerDay` cap (default 2). Returns the soonest such event, or null.
 *
 * Pure: the caller passes the current ET minutes-past-midnight and the set of
 * keys already flagged, both of which it reads from the clock and the store.
 */
export function dueEventHeadsUp(
  events: ScheduledEvent[],
  opts: {
    today: string;
    etMinutesNow: number;
    postedKeys: string[];
    postedCount: number;
    leadMin?: number;
    maxPerDay?: number;
  },
): HeadsUpDecision | null {
  const leadMin = opts.leadMin ?? 15;
  const maxPerDay = opts.maxPerDay ?? 2;
  if (opts.postedCount >= maxPerDay) return null;

  const posted = new Set(opts.postedKeys);
  const candidates: HeadsUpDecision[] = [];

  for (const e of notableToday(events, opts.today)) {
    const start = toMinutes(e.timeEt);
    if (start === null) continue;
    const minutesUntil = start - opts.etMinutesNow;
    if (minutesUntil < 0 || minutesUntil > leadMin) continue; // past, or not yet close
    const key = eventHeadsUpKey(e);
    if (posted.has(key)) continue;
    candidates.push({ event: e, key, minutesUntil });
  }

  candidates.sort((a, b) => a.minutesUntil - b.minutesUntil);
  return candidates[0] ?? null;
}

/**
 * The heads-up post text. Fixed template, deliberately plain and safe — no
 * buy/sell wording, no jargon, with the disclaimer on its own line. Stays well
 * under the 280-character limit.
 */
export function eventHeadsUpText(e: ScheduledEvent, minutesUntil = 15): string {
  const lead = Math.max(1, Math.round(minutesUntil));
  const who = e.who ? `${e.who} — ${e.name}` : e.name;
  return (
    `📅 Heads up: ${who} in about ${lead} min (${ctLabel(e)} CT).\n` +
    `Positioning levels read less cleanly around scheduled news.\n` +
    `Not financial advice`
  );
}
