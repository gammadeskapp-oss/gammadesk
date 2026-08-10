import 'server-only';

import { cached } from '../cache';
import { createJsonStore } from '../jsonStore';
import { formatExpiryLabel } from '../time';
import { captureSnapshot } from './compute';
import type {
  StoredVelocity,
  VelocityResult,
  VelocityRow,
  VelocitySnapshot,
  VelocityTag,
} from './types';

export { storeStatus } from '../jsonStore';

/** Snapshots retained. Enough to survive a couple of missed days. */
const KEEP = 6;
/** Below this dollar move, a change is noise rather than news. */
const MIN_ABS_CHANGE = 2_000_000;
/** Rows shown. */
const MAX_ROWS = 80;
/** In-process reuse, so a burst of views shares one store read. */
const MEMO_SECONDS = 900;

const store = createJsonStore<StoredVelocity>(
  'gammadesk/velocity.json',
  () => ({ snapshots: [] }),
  (raw) =>
    raw && typeof raw === 'object' && Array.isArray((raw as StoredVelocity).snapshots)
      ? (raw as StoredVelocity)
      : null,
);

function newestFirst(snapshots: VelocitySnapshot[]): VelocitySnapshot[] {
  return [...snapshots].sort((a, b) => b.date.localeCompare(a.date));
}

function key(row: { t: string; e: string; k: number }): string {
  return `${row.t}|${row.e}|${row.k}`;
}

/**
 * Diff the two most recent snapshots.
 *
 * A strike present in one and absent in the other is treated as zero on the
 * missing side. That is honest for genuinely new strikes, and very slightly
 * overstates shrinkage for a strike that merely dropped under the storage
 * floor — the floor is small enough that the difference does not change any
 * ranking near the top of the table.
 */
function diff(current: VelocitySnapshot, previous: VelocitySnapshot): VelocityRow[] {
  const before = new Map(previous.strikes.map((s) => [key(s), s.g]));
  const after = new Map(current.strikes.map((s) => [key(s), s.g]));

  const allKeys = new Set([...before.keys(), ...after.keys()]);
  const rows: VelocityRow[] = [];

  for (const k of allKeys) {
    const [symbol, expiration, strikeText] = k.split('|');
    const strike = Number(strikeText);
    const was = before.get(k) ?? 0;
    const now = after.get(k) ?? 0;
    const change = now - was;

    if (Math.abs(change) < MIN_ABS_CHANGE) continue;

    // Magnitude, not sign — a strike going from +50M to -50M has not "grown".
    const tag: VelocityTag =
      was === 0 ? 'NEW' : Math.abs(now) > Math.abs(was) ? 'GREW' : 'SHRANK';

    const spot = current.spots[symbol] ?? previous.spots[symbol] ?? 0;

    rows.push({
      symbol,
      expiration,
      expiryLabel: formatExpiryLabel(expiration),
      strike,
      was,
      now,
      change,
      changePct: was === 0 ? null : (change / Math.abs(was)) * 100,
      tag,
      spot,
      distancePct: spot > 0 ? ((strike - spot) / spot) * 100 : 0,
    });
  }

  return rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, MAX_ROWS);
}

function toResult(stored: StoredVelocity): VelocityResult {
  const snapshots = newestFirst(stored.snapshots);
  const current = snapshots[0];
  const previous = snapshots[1];

  const notes: string[] = [];
  if (current?.failures.length) {
    notes.push(
      `${current.failures.length} symbols had no readable chain: ${current.failures.join(', ')}.`,
    );
  }

  return {
    rows: current && previous ? diff(current, previous) : [],
    currentDate: current?.date ?? '',
    previousDate: previous?.date ?? null,
    capturedAt: current?.capturedAt ?? '',
    symbols: current?.symbols.length ?? 0,
    snapshotsStored: snapshots.length,
    totalCompared: current?.strikes.length ?? 0,
    notes,
  };
}

/**
 * Capture today's book if it is not already stored, then diff.
 *
 * The guard is on the CHAIN's date, so repeat runs — including every visit
 * over a weekend, when Cboe still serves Friday's book — are no-ops rather
 * than storing duplicate days that would diff to zero.
 */
export async function refreshVelocity(): Promise<VelocityResult> {
  const stored = await store.read().catch(() => ({ snapshots: [] }));
  const snapshot = await captureSnapshot();

  const already = stored.snapshots.some((s) => s.date === snapshot.date);
  if (already) return toResult(stored);

  const next: StoredVelocity = {
    snapshots: newestFirst([...stored.snapshots, snapshot]).slice(0, KEEP),
  };

  try {
    await store.write(next);
  } catch {
    // Serve what we computed even if it could not be persisted; the next run
    // will try again.
  }

  return toResult(next);
}

/** What the page reads. Captures at most once per trading day. */
export function getVelocity(): Promise<VelocityResult> {
  return cached('velocity:result', MEMO_SECONDS, async () => {
    const stored = await store.read().catch(() => ({ snapshots: [] }));
    const newest = newestFirst(stored.snapshots)[0];

    // Older than a day, or nothing at all: capture. Otherwise just diff.
    const stale =
      !newest ||
      Date.now() - Date.parse(newest.capturedAt) > 20 * 60 * 60 * 1000;

    if (!stale) return toResult(stored);

    try {
      return await refreshVelocity();
    } catch {
      return toResult(stored);
    }
  });
}
