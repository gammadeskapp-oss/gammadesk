import 'server-only';

import { cached, ttlRemaining } from '../cache';
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
  MOVERS_EXPLANATION_LIVE,
  MOVERS_EXPLANATION_LIVE_CLOSED,
  MOVERS_EXPLANATION_LIVE_PREOPEN,
  MOVERS_HEADING,
} from './types';

/**
 * The read path for /movers.
 *
 * ## Refreshed on read, with no cron and no store
 *
 * Deliberately different from every other engine here. The scanner, the
 * digest, velocity and the RS shards all write a document because their inputs
 * are expensive or unrepeatable — a chain quoted at 08:30 cannot be quoted
 * again at noon, so it has to be kept. This has neither problem: the reading is
 * one cheap request over stored history, and a completed session is by
 * definition still there tomorrow.
 *
 * So there is no blob document and no scheduled job. The whole result is
 * memoised in process, and the first page view after it expires pays for the
 * next one. Three consequences, all of them wanted:
 *
 * - No cron entry to drift, and no stored series that would start on the day
 *   this merged and could never be backfilled.
 * - Nobody watching means nothing is spent. A weekend costs zero requests.
 * - Nothing to reconcile: the page cannot show a session the stored history
 *   disagrees with, because it reads the session out of that history.
 *
 * ## One interval, because the answer only changes overnight
 *
 * There is no faster and slower clock here any more. The reported session
 * changes when the relative-strength refresh lands a new one overnight, and
 * nothing that happens during the trading day can alter a figure from a day
 * that has already closed. Re-reading every quarter of an hour through a
 * session would spend requests to receive the identical answer.
 */

/**
 * How long a reading is held.
 *
 * An hour. The underlying session cannot change until the overnight refresh
 * stores a new one, so this is only ever about how soon the first reader of
 * the morning sees it — not about tracking anything.
 */
export const REFRESH_SECONDS = 3600;

const KEY = 'movers:result';

export async function getMovers(now: Date = new Date()): Promise<MoversResult> {
  return cached(KEY, REFRESH_SECONDS, () => computeMovers(now));
}

/**
 * Seconds until the memoised reading expires, or 0 when it already has.
 *
 * Not shown on the page any more — the reported session is what identifies
 * this reading, not the clock it was fetched on. Kept because the staleness
 * banner and the status page still ask how old a memoised reading is.
 */
export function secondsUntilRefresh(): number {
  return Math.round(ttlRemaining(KEY) / 1000);
}
