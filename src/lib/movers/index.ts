import 'server-only';

import { cached, ttlRemaining } from '../cache';
import { marketSessionRules } from '../events';
import { inSession } from '../staleness';
import { computeMovers } from './compute';
import type { MoversResult } from './types';

export type {
  MoverRow,
  MoverWarning,
  MoversResult,
  TrendPosition,
} from './types';
export {
  HIGH_RELATIVE_VOLUME,
  MAX_MOVERS,
  MIN_RELATIVE_VOLUME,
  MOVERS_EXPLANATION,
  MOVERS_HEADING,
} from './types';

/**
 * The read path for /movers.
 *
 * ## Refreshed on read, on a fifteen-minute clock, with no cron and no store
 *
 * Deliberately different from every other engine here. The scanner, the
 * digest, velocity and the RS shards all write a document because their inputs
 * are expensive or unrepeatable — a chain quoted at 08:30 cannot be quoted
 * again at noon, so it has to be kept. This has neither problem: the reading is
 * two cheap requests, and it is a snapshot of right now, which is by definition
 * always re-obtainable.
 *
 * So there is no blob document and no scheduled job. The whole result is memoised
 * in process for `REFRESH_SECONDS`, and the first page view after it expires
 * pays for the next one. Three consequences, all of them wanted:
 *
 * - No cron entry to drift, and no stored series that would start on the day
 *   this merged and could never be backfilled.
 * - Nobody watching means nothing is spent. A weekend costs zero requests.
 * - After the close the same call returns the last session's final numbers,
 *   because that is what a quote feed serves once trading has stopped. The
 *   close is not a special stored case here; it is the ordinary reading taken
 *   after the session ended, and the page labels it as the close from
 *   `MoversResult.live`.
 */

/** The refresh interval. Fifteen minutes — this is a glance, not a tape. */
export const REFRESH_SECONDS = 900;

/**
 * How long a reading is held once the market has shut.
 *
 * The numbers cannot change again until the next open, so refetching them
 * every quarter of an hour all evening and all weekend would spend requests to
 * receive the identical answer. An hour is short enough that the first reader
 * after an open is never served yesterday.
 */
const CLOSED_SECONDS = 3600;

const KEY = 'movers:result';

export async function getMovers(now: Date = new Date()): Promise<MoversResult> {
  const ttl = inSession(now, marketSessionRules()) ? REFRESH_SECONDS : CLOSED_SECONDS;
  return cached(KEY, ttl, () => computeMovers(now));
}

/**
 * Seconds until the memoised reading expires, or 0 when it already has.
 *
 * Shown on the page beside the capture time, so "last refreshed 09:47" is
 * accompanied by when the next one is due rather than leaving a reader to
 * guess whether a fourteen-minute-old number is broken or simply on schedule.
 */
export function secondsUntilRefresh(): number {
  return Math.round(ttlRemaining(KEY) / 1000);
}
