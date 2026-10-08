/**
 * The fetched-events document shape and the pure fold of a refresh into it.
 *
 * Kept free of IO (the Blob access lives in `store.ts`) so `verify:fed-events`
 * can check the load-bearing rule directly: a source that fails this run keeps
 * the events it last returned and only stamps the error, so one feed going dark
 * never blanks the calendar.
 */

import type { ScheduledEvent } from '../rules';
import { EVENT_SOURCES, type EventSource } from './types';

export const FEED_SCHEMA = 1;

export interface FeedSourceState {
  /** The events this source last returned, already trimmed to the window. */
  events: ScheduledEvent[];
  /** When this source last fetched cleanly, or null if it never has. */
  lastOkAt: string | null;
  /** How many events the last clean fetch produced. */
  count: number;
  /** The most recent failure message, or null when the last run was clean. */
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface FeedDoc {
  schema: number;
  /** When any source last wrote, or null before the first refresh. */
  updatedAt: string | null;
  bySource: Record<EventSource, FeedSourceState>;
}

/** The outcome of fetching one source this run. */
export type SourceResult =
  | { ok: true; events: ScheduledEvent[] }
  | { ok: false; error: string };

export function emptySource(): FeedSourceState {
  return { events: [], lastOkAt: null, count: 0, lastError: null, lastErrorAt: null };
}

export function emptyFeedDoc(): FeedDoc {
  return {
    schema: FEED_SCHEMA,
    updatedAt: null,
    bySource: Object.fromEntries(
      EVENT_SOURCES.map((s) => [s, emptySource()]),
    ) as Record<EventSource, FeedSourceState>,
  };
}

/** Every stored event across all sources, newest-good per source. */
export function allFeedEvents(doc: FeedDoc): ScheduledEvent[] {
  return EVENT_SOURCES.flatMap((s) => doc.bySource[s]?.events ?? []);
}

/**
 * Fold this run's per-source results into a document. Pure — returns a new
 * document, never mutates the input. A clean result replaces that source's
 * events and clears its error; a failure keeps the stored events and records
 * the error; a source absent from `results` is untouched.
 */
export function foldRefresh(
  current: FeedDoc,
  results: Partial<Record<EventSource, SourceResult>>,
  now: Date,
): FeedDoc {
  const bySource = { ...current.bySource };
  let wroteAnything = false;

  for (const source of EVENT_SOURCES) {
    const result = results[source];
    if (!result) continue;
    const prev = bySource[source] ?? emptySource();

    if (result.ok) {
      bySource[source] = {
        events: result.events,
        lastOkAt: now.toISOString(),
        count: result.events.length,
        lastError: null,
        lastErrorAt: null,
      };
    } else {
      bySource[source] = { ...prev, lastError: result.error, lastErrorAt: now.toISOString() };
    }
    wroteAnything = true;
  }

  return {
    schema: FEED_SCHEMA,
    updatedAt: wroteAnything ? now.toISOString() : current.updatedAt,
    bySource,
  };
}
