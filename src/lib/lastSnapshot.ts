import 'server-only';

import type { ChainSnapshot } from './chainSource';
import { config } from './config';
import { createJsonStore } from './jsonStore';
import type { DataSource } from './types';

/**
 * The last chain snapshot that was successfully fetched, kept so a dead feed
 * degrades into stale data rather than into no page at all.
 *
 * ## Why this did not exist before, and why that was a bug
 *
 * Every other dataset here — breadth, flow, groups, sectors, relative strength,
 * the scanner, the log — is written to durable storage by a cron and read back
 * by the page. Positioning was the exception: its only cache was the in-process
 * TTL map in `cache.ts`, and that has two properties that together guarantee a
 * hard failure.
 *
 * First, it is per-process. On a serverless host most requests arrive at a cold
 * instance with an empty map, so the "cache" is usually not there at all.
 *
 * Second, and worse, when an entry expires the old value is *discarded* rather
 * than held as a fallback: `cached()` falls through to the producer, the
 * producer throws, and the error propagates with a perfectly good five-minute-old
 * snapshot sitting unused in memory.
 *
 * So there was never a last-good snapshot to serve. The page did not fail
 * because a fallback was skipped; it failed because nothing had ever been
 * written down.
 *
 * ## Why this is not "sample data"
 *
 * This project refuses to synthesise numbers when the feed is down, and that
 * rule stands. What is stored here is not invented — it is a real snapshot that
 * really was fetched, with its own original `quoteDate`. Serving it is the
 * difference between "here is what the book looked like at 09:41" and "here is
 * what the book might look like". The first is a fact with a timestamp on it.
 *
 * The timestamp is what makes it safe, and it is load-bearing: `quoteDate` is
 * carried through unchanged, `snapshotStaleness` grades it against the last
 * completed session, and `StaleDataBanner` puts a non-dismissible warning above
 * everything on the page. A recovered snapshot can therefore never present
 * itself as live.
 *
 * ## Scope: the configured symbol only
 *
 * Only `config.symbol` is stored. Arbitrary tickers typed into the search box
 * are not: that would be an unbounded write for a page nobody is going to
 * reload, and the failure mode this exists to fix is the front door being down,
 * not one stock lookup missing.
 */

/** `quoteDate` is a `Date`; JSON round-trips it as an ISO string. */
interface StoredSnapshot {
  symbol: string;
  source: DataSource;
  /** ISO-8601. */
  quoteDate: string;
  spot: number;
  contracts: ChainSnapshot['contracts'];
  activity?: ChainSnapshot['activity'];
  notes: string[];
  /** When this was written, as distinct from what it describes. */
  savedAt: string;
  /** The trim window it was built under, so a config change invalidates it. */
  maxExpirations: number;
  strikesEachSide: number;
}

interface LastSnapshotDoc {
  snapshot: StoredSnapshot | null;
}

const lastSnapshotStore = createJsonStore<LastSnapshotDoc>(
  'gammadesk/last-snapshot.json',
  () => ({ snapshot: null }),
  (raw) =>
    raw && typeof raw === 'object' && 'snapshot' in raw
      ? (raw as LastSnapshotDoc)
      : null,
);

export interface RecoveredSnapshot {
  snapshot: ChainSnapshot;
  source: DataSource;
  /** How old the *fetch* is. Distinct from the age of the quote it carries. */
  savedAt: string;
}

/**
 * Write through on every successful fetch.
 *
 * Never throws and never blocks the caller's result: a storage failure must not
 * turn a working page into a broken one. The snapshot the reader asked for has
 * already been built by the time this runs.
 */
export async function saveLastGoodSnapshot(
  snapshot: ChainSnapshot,
  source: DataSource,
): Promise<void> {
  const doc: LastSnapshotDoc = {
    snapshot: {
      symbol: config.symbol,
      source,
      quoteDate: snapshot.quoteDate.toISOString(),
      spot: snapshot.spot,
      contracts: snapshot.contracts,
      activity: snapshot.activity,
      notes: snapshot.notes,
      savedAt: new Date().toISOString(),
      maxExpirations: config.maxExpirations,
      strikesEachSide: config.strikesEachSide,
    },
  };

  try {
    await lastSnapshotStore.write(doc);
  } catch {
    // Deliberately swallowed. See above.
  }
}

/**
 * The last good snapshot, or null when there is none to serve.
 *
 * Returns null rather than throwing for every failure mode, including a stored
 * document built under a different trim window — a snapshot cut to five
 * expirations cannot answer a twenty-expiration view, and quietly serving the
 * narrower one would produce a forecast missing most of its horizon with
 * nothing on the page to say so.
 */
export async function readLastGoodSnapshot(): Promise<RecoveredSnapshot | null> {
  const doc = await lastSnapshotStore.read().catch(() => null);
  const stored = doc?.snapshot;
  if (!stored) return null;

  // A snapshot for another ticker is not a fallback for this one.
  if (stored.symbol !== config.symbol) return null;

  if (
    stored.maxExpirations < config.maxExpirations ||
    stored.strikesEachSide < config.strikesEachSide
  ) {
    return null;
  }

  const quoteDate = new Date(stored.quoteDate);
  if (Number.isNaN(quoteDate.getTime())) return null;
  if (!Array.isArray(stored.contracts) || stored.contracts.length === 0) return null;

  return {
    source: stored.source,
    savedAt: stored.savedAt,
    snapshot: {
      spot: stored.spot,
      quoteDate,
      contracts: stored.contracts,
      // Zero, because no upstream request was spent recovering this. The
      // number is reported on /status as traffic actually incurred.
      requests: 0,
      activity: stored.activity,
      notes: stored.notes,
    },
  };
}

/** Whether a last-good snapshot is on file, for `/status` to report. */
export async function lastGoodSnapshotStatus(): Promise<{
  present: boolean;
  quoteDate: string | null;
  savedAt: string | null;
}> {
  const doc = await lastSnapshotStore.read().catch(() => null);
  const stored = doc?.snapshot;
  return {
    present: Boolean(stored),
    quoteDate: stored?.quoteDate ?? null,
    savedAt: stored?.savedAt ?? null,
  };
}
