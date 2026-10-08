/**
 * Seeded Fed/Treasury events — for the PREVIEW and the TESTS only.
 *
 * ⚠ This module must never be reached on the production fetch path. The refresh
 * orchestrator (`refresh.ts`) only calls `seededFeedEvents` when it is asked to
 * with an explicit `seed: true`, which the cron route never passes — the cron
 * always does the real network fetch. The guard is enforced by a test in
 * `verify:fed-events`. Nothing here is real data; it exists so the dashboard
 * list can be shown before the live feed has run, and so the parsers and the
 * merge have a stable fixture to be checked against.
 *
 * The set mirrors a representative Fed day: a Chair appearance (HIGH), a Board
 * governor speech and the FOMC minutes (MEDIUM), and a 10-year note auction
 * (MEDIUM). The regional Fed presidents (Kashkari, Musalem, …) are deliberately
 * absent — they are the pending TODO (see `sources/REGIONAL_FED_TODO.md`) and
 * would not appear in production either, so the preview does not pretend they do.
 */

import { buildFetchedEvent, type FetchedEvent } from './types';

/**
 * Whether seeding is permitted. Pure and env-driven: the fixtures are honoured
 * only outside production, so even a stray `seed` flag on a production request
 * falls through to the real fetch. `verify:fed-events` pins both cases.
 */
export function seedingAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production';
}

const FED_URL = 'https://www.federalreserve.gov/newsevents.htm';
const TREASURY_URL = 'https://www.treasurydirect.gov/auctions/upcoming/';

/** A seeded day's events, dated onto `today` (`YYYY-MM-DD`). Pure. */
export function seededFeedEvents(today: string): FetchedEvent[] {
  return [
    buildFetchedEvent({
      date: today,
      timeEt: '12:30',
      name: 'Chair Powell gives opening remarks',
      importance: 'high',
      source: 'fed-board',
      sourceUrl: FED_URL,
      who: 'Chair Powell',
      topic: 'Opening remarks at a community banking conference',
    }),
    buildFetchedEvent({
      date: today,
      timeEt: '09:15',
      name: 'Governor Waller speaks on the economic outlook',
      importance: 'medium',
      source: 'fed-board',
      sourceUrl: FED_URL,
      who: 'Governor Waller',
      topic: 'Economic outlook',
    }),
    buildFetchedEvent({
      date: today,
      timeEt: '14:00',
      name: 'FOMC: Minutes of the September meeting',
      importance: 'medium',
      source: 'fed-board',
      sourceUrl: FED_URL,
      topic: 'Minutes of the September FOMC meeting',
    }),
    buildFetchedEvent({
      date: today,
      timeEt: '13:00',
      name: '10-Year Note auction',
      importance: 'medium',
      source: 'treasury',
      sourceUrl: TREASURY_URL,
      topic: 'Treasury auction',
    }),
  ];
}
