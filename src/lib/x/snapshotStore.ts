import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { SourceChoice } from '../config';
import type { DeskSnapshot } from './compose';

/**
 * The ready-made desk snapshot, computed once by the `/api/x/snapshot` cron and
 * read by the poster tick (and anything else that wants the SPY figures without
 * paying for a full chain fetch + IV-surface parse).
 *
 * ## Why this exists
 *
 * `deskData.computeDeskSnapshot` is expensive: it fetches the whole ~6 MB option
 * chain, resolves an implied-vol surface across thousands of contracts, and
 * derives the exposure levels. On a cold serverless instance that runs tens of
 * seconds. When the 5-minute poster tick did that inline it risked its own
 * function timeout — so it silently produced nothing, which is exactly the
 * "no posts, no log rows" gap this store removes. Now one cron pays the cost and
 * writes this small object; the tick reads it in well under a second.
 */
export interface CachedDeskSnapshot {
  /** The figures every post is built from — spot, levels, movers, freshness. */
  snapshot: DeskSnapshot;
  /** Which upstream the chain behind the levels came from. */
  source: SourceChoice;
  /** When the cron computed and wrote this (distinct from the data's own age). */
  builtAtIso: string;
}

const snapshotStore = createJsonStore<CachedDeskSnapshot | null>(
  'gammadesk/x-desk-snapshot.json',
  () => null,
  (raw) => {
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as CachedDeskSnapshot).builtAtIso === 'string' &&
      (raw as CachedDeskSnapshot).snapshot &&
      typeof (raw as CachedDeskSnapshot).snapshot === 'object'
    ) {
      return raw as CachedDeskSnapshot;
    }
    return null;
  },
);

/** Persist the freshly computed snapshot for the tick to read. */
export async function writeCachedDeskSnapshot(value: CachedDeskSnapshot): Promise<void> {
  await snapshotStore.write(value);
}

/** The last snapshot the cron wrote, or null when it has never run this session. */
export async function readCachedDeskSnapshot(): Promise<CachedDeskSnapshot | null> {
  return snapshotStore.read().catch(() => null);
}

/**
 * One tick's outcome, written on every firing so the heartbeat is visible from
 * the outside — the fix for the old silent gaps, where a tick that decided
 * "not due" or "data stale" left no trace at all. The post log still records
 * only genuine post attempts; this is the separate "the cron ran and here is
 * what it decided" record.
 */
export interface TickHeartbeat {
  /** When this tick ran. */
  at: string;
  /** The decision: morning | intraday | closing | summary | wait | idle. */
  decision: string;
  /** The plain-English reason for that decision. */
  reason: string;
  /** The post outcome, when this tick actually attempted a post. */
  outcome: string | null;
  /** True when the cached snapshot was missing or past the freshness limit. */
  stale: boolean;
  /** Age in minutes of the cached snapshot's market data, or null when absent. */
  dataAgeMin: number | null;
  /** When the snapshot the tick read was built, or null when none was found. */
  snapshotBuiltAt: string | null;
}

const heartbeatStore = createJsonStore<TickHeartbeat | null>(
  'gammadesk/x-tick-heartbeat.json',
  () => null,
  (raw) => {
    if (raw && typeof raw === 'object' && typeof (raw as TickHeartbeat).at === 'string') {
      return raw as TickHeartbeat;
    }
    return null;
  },
);

/** Record this tick's decision. Best-effort — a lost beat never blocks a post. */
export async function writeTickHeartbeat(beat: TickHeartbeat): Promise<void> {
  await heartbeatStore.write(beat).catch(() => {});
}

/** The most recent tick heartbeat, for the health endpoint. */
export async function readTickHeartbeat(): Promise<TickHeartbeat | null> {
  return heartbeatStore.read().catch(() => null);
}
