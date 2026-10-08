/**
 * The fetched-events feed — shared pure types and the small classifiers.
 *
 * ## Why this is split from the fetch
 *
 * The same rule `rules.ts` explains at length: nothing here imports
 * `server-only` or performs IO, so `verify:fed-events` can run it through
 * Node's type-stripping loader and exercise the parsers against fixtures. The
 * network fetch and the Blob store live in the sibling files that do import
 * `server-only` (`sources/*.ts`, `store.ts`, `refresh.ts`).
 *
 * ## Scope, for now
 *
 * Fed **Board** calendar (FOMC meetings, minutes, press conferences, and Chair
 * + Board-governor speeches) and **Treasury** auctions only. The regional Fed
 * presidents (Kashkari, Musalem, Schmid, Logan, …) are a deliberate TODO — see
 * `sources/REGIONAL_FED_TODO.md` — until a reliable machine-readable source is
 * picked. Jobs and CPI continue to come from the hand-maintained
 * `calendar.json`, not from here.
 */

import type { Importance, ScheduledEvent } from '../rules';

/** The feeds this module fetches. */
export type EventSource = 'fed-board' | 'treasury';

export const EVENT_SOURCES: EventSource[] = ['fed-board', 'treasury'];

/** A human label per source, for the admin health view. */
export const EVENT_SOURCE_LABEL: Record<EventSource, string> = {
  'fed-board': 'Federal Reserve Board calendar',
  treasury: 'TreasuryDirect auctions',
};

/**
 * A fetched event. A `ScheduledEvent` with the source fields always filled —
 * the optional extras on `ScheduledEvent` exist precisely so these can ride
 * alongside the hand-maintained entries without a second type everywhere.
 */
export interface FetchedEvent extends ScheduledEvent {
  timeCt: string;
  source: EventSource;
  sourceUrl: string;
}

// --- Fed Board importance ----------------------------------------------------

/**
 * The importance of a Fed Board calendar item from its title. Pure, so the
 * table is testable line by line.
 *
 *   HIGH    FOMC rate decision / statement, the post-meeting press conference,
 *           and any speech or testimony by the Chair.
 *   MEDIUM  FOMC minutes, and speeches/testimony by a Board governor.
 *   LOW     everything else the Board publishes.
 *
 * CPI and the jobs report are intentionally NOT classified here — they are not
 * Board events and stay in `calendar.json`.
 */
export function fedBoardImportance(title: string, opts?: { who?: string }): Importance {
  const t = title.toLowerCase();
  const who = (opts?.who ?? '').toLowerCase();

  const isChair = /\bchair\b/.test(who) || /\bchair\b/.test(t);

  // FOMC rate decision / statement, or the press conference → HIGH.
  if (/fomc/.test(t) && /(statement|decision|rate|press conference)/.test(t)) {
    return 'high';
  }
  // The Chair speaking or testifying → HIGH.
  if (isChair && /(speech|speaks|testimony|testifies|remarks|statement)/.test(t + ' ' + who)) {
    return 'high';
  }
  // FOMC minutes → MEDIUM.
  if (/fomc/.test(t) && /minutes/.test(t)) return 'medium';
  // A Board governor speaking → MEDIUM.
  if (/\bgovernor\b/.test(who) || /\bgovernor\b/.test(t)) return 'medium';

  return 'low';
}

// --- Treasury auction importance ---------------------------------------------

/**
 * The importance of a Treasury auction from its security type and term.
 *
 *   MEDIUM  the 10-year note through the 30-year bond — the auctions that move
 *           the long end and, with it, rate-sensitive equities.
 *   LOW     bills and the shorter coupons.
 */
export function treasuryAuctionImportance(securityType: string, termYears: number | null): Importance {
  const type = securityType.toLowerCase();
  // Bills are always short-dated money-market paper → LOW.
  if (type.includes('bill')) return 'low';
  // 10y notes and 20y/30y bonds → MEDIUM; shorter coupons → LOW.
  if (termYears !== null && termYears >= 10) return 'medium';
  return 'low';
}

// --- time ---------------------------------------------------------------------

/**
 * A New York wall clock shifted to Central, `HH:MM` → `HH:MM`. CT is ET − 1h
 * year-round (both observe DST together), so this is a plain hour subtraction
 * with a wrap at midnight. Returns null for a malformed input rather than
 * guessing.
 */
export function etToCt(timeEt: string): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeEt);
  if (!m) return null;
  const hour = (Number(m[1]) + 23) % 24; // −1 hour, wrapping 00 → 23
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

/** Build a `FetchedEvent`, filling `timeCt` from `timeEt`. Pure. */
export function buildFetchedEvent(input: {
  date: string;
  timeEt: string;
  name: string;
  importance: Importance;
  source: EventSource;
  sourceUrl: string;
  who?: string;
  topic?: string;
  confirmed?: boolean;
}): FetchedEvent {
  return {
    date: input.date,
    timeEt: input.timeEt,
    timeCt: etToCt(input.timeEt) ?? input.timeEt,
    name: input.name,
    importance: input.importance,
    confirmed: input.confirmed ?? true,
    source: input.source,
    sourceUrl: input.sourceUrl,
    ...(input.who ? { who: input.who } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
  };
}
