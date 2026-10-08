import 'server-only';

import { marketToday } from '../../time';
import { addDays } from './merge';
import {
  applyRefresh,
  readFeedDoc,
  type FeedDoc,
  type SourceResult,
} from './store';
import { fetchFedBoard } from './sources/fedBoard';
import { fetchTreasuryAuctions } from './sources/treasury';
import { seededFeedEvents, seedingAllowed } from './fixtures';
import { EVENT_SOURCES, type EventSource } from './types';

export { seedingAllowed };

/**
 * The refresh orchestrator — fetch both feeds for the next seven days, fold the
 * results into the store (keeping the last good data for any source that
 * failed), and report the health.
 *
 * ## Seeding is development-only
 *
 * `seed: true` loads the fixtures instead of the network — for the preview and
 * the tests only. It is honoured ONLY when `NODE_ENV !== 'production'`, so even
 * if the flag reached a production request it would fall through to the real
 * fetch. The cron route never passes it. `verify:fed-events` asserts both: that
 * seeding works in a non-prod run and that a prod-marked run ignores it.
 */

export const FEED_WINDOW_DAYS = 7;

export interface SourceHealth {
  source: EventSource;
  ok: boolean;
  /** Events currently stored for this source (kept if the fetch failed). */
  count: number;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface RefreshResult {
  seeded: boolean;
  window: { from: string; to: string };
  updatedAt: string | null;
  sources: SourceHealth[];
}

function summarise(doc: FeedDoc): SourceHealth[] {
  return EVENT_SOURCES.map((source) => {
    const s = doc.bySource[source];
    return {
      source,
      ok: s.lastError === null && s.lastOkAt !== null,
      count: s.events.length,
      lastOkAt: s.lastOkAt,
      lastError: s.lastError,
      lastErrorAt: s.lastErrorAt,
    };
  });
}

export async function refreshFedEvents(
  opts: { seed?: boolean; now?: Date } = {},
): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const from = marketToday(now);
  const to = addDays(from, FEED_WINDOW_DAYS);
  const seeding = Boolean(opts.seed) && seedingAllowed();

  let results: Partial<Record<EventSource, SourceResult>>;
  if (seeding) {
    const seeded = seededFeedEvents(from);
    results = {
      'fed-board': { ok: true, events: seeded.filter((e) => e.source === 'fed-board') },
      treasury: { ok: true, events: seeded.filter((e) => e.source === 'treasury') },
    };
  } else {
    const [fed, treasury] = await Promise.all([
      fetchFedBoard({ from, to }),
      fetchTreasuryAuctions({ from, to }),
    ]);
    results = { 'fed-board': fed, treasury };
  }

  const doc = await applyRefresh(results, now);
  return { seeded: seeding, window: { from, to }, updatedAt: doc.updatedAt, sources: summarise(doc) };
}

/** The current health without fetching — for the admin view. */
export async function fedEventsHealth(): Promise<RefreshResult> {
  const doc = await readFeedDoc();
  return {
    seeded: false,
    window: { from: marketToday(), to: addDays(marketToday(), FEED_WINDOW_DAYS) },
    updatedAt: doc.updatedAt,
    sources: summarise(doc),
  };
}
