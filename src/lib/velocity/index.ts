import 'server-only';

import { cached } from '../cache';
import { createJsonStore } from '../jsonStore';
import { scanSymbolCount } from '../scanUniverse';
import { formatExpiryLabel } from '../time';
import { captureSnapshot } from './compute';
import type {
  RollOffReason,
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

/** The distinct expirations a snapshot actually captured. */
function expirations(snapshot: VelocitySnapshot): Set<string> {
  return new Set(snapshot.strikes.map((s) => s.e));
}

/**
 * Diff the two most recent snapshots.
 *
 * A strike present in one and absent in the other is treated as zero on the
 * missing side. That is honest for genuinely new strikes, and very slightly
 * overstates shrinkage for a strike that merely dropped under the storage
 * floor — the floor is small enough that the difference does not change any
 * ranking near the top of the table.
 *
 * It is *not* honest when the whole expiration is missing on one side, which
 * is the common case rather than a corner one: every Friday the front expiry
 * expires, and the next morning its entire strike ladder reads as collapsing
 * to zero. Those were the largest "SHRANK" rows on the page and none of them
 * were repositioning — the contracts simply stopped existing.
 *
 * So the test is per expiration, not per strike: compare only expirations
 * captured on both days. The rest are separated out with a reason. The same
 * rule catches the mirror image, an expiration entering the captured window
 * with open interest already built up, which was showing as a block of
 * enormous "NEW" rows that nobody had opened either.
 */
function diff(
  current: VelocitySnapshot,
  previous: VelocitySnapshot,
): { rows: VelocityRow[]; rolledOff: VelocityRow[]; uncomparableSymbols: string[] } {
  const before = new Map(previous.strikes.map((s) => [key(s), s.g]));
  const after = new Map(current.strikes.map((s) => [key(s), s.g]));

  const currentExpiries = expirations(current);
  const previousExpiries = expirations(previous);

  /*
   * Only symbols read on both days can be compared at all.
   *
   * A run has a fixed time budget, so a long list can end a day short of its
   * tail. A symbol missing from one side would otherwise show every one of its
   * strikes collapsing to zero — the same false reading as an expired contract,
   * but across a whole ticker at once. These are dropped rather than labelled:
   * "we did not look" is not a fact about the market, and there could be
   * hundreds of such rows.
   */
  const currentSymbols = new Set(current.symbols);
  const comparable = new Set(previous.symbols.filter((s) => currentSymbols.has(s)));
  const uncomparable = new Set<string>();

  const allKeys = new Set([...before.keys(), ...after.keys()]);
  const rows: VelocityRow[] = [];
  const rolledOff: VelocityRow[] = [];

  for (const k of allKeys) {
    const [symbol, expiration, strikeText] = k.split('|');
    const strike = Number(strikeText);

    if (!comparable.has(symbol)) {
      uncomparable.add(symbol);
      continue;
    }
    const was = before.get(k) ?? 0;
    const now = after.get(k) ?? 0;
    const change = now - was;

    if (Math.abs(change) < MIN_ABS_CHANGE) continue;

    const inCurrent = currentExpiries.has(expiration);
    const inPrevious = previousExpiries.has(expiration);

    let rollOff: RollOffReason | undefined;
    if (!inCurrent || !inPrevious) {
      // Dated against the chain's trading day rather than the wall clock, for
      // the same reason snapshots are — the newest book can be days old.
      if (expiration < current.date) rollOff = 'expired';
      else if (inPrevious) rollOff = 'left-window';
      else rollOff = 'entered-window';
    }

    // Magnitude, not sign — a strike going from +50M to -50M has not "grown".
    const tag: VelocityTag =
      was === 0 ? 'NEW' : Math.abs(now) > Math.abs(was) ? 'GREW' : 'SHRANK';

    const spot = current.spots[symbol] ?? previous.spots[symbol] ?? 0;

    const row: VelocityRow = {
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
      ...(rollOff ? { rollOff } : {}),
    };

    (rollOff ? rolledOff : rows).push(row);
  }

  const biggestFirst = (a: VelocityRow, b: VelocityRow) =>
    Math.abs(b.change) - Math.abs(a.change);

  return {
    rows: rows.sort(biggestFirst),
    rolledOff: rolledOff.sort(biggestFirst),
    uncomparableSymbols: [...uncomparable].sort(),
  };
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

  if (current?.skipped?.length) {
    notes.push(
      `${current.skipped.length} symbols were not reached on the last run: ${current.skipped.join(', ')}. ` +
        'Cboe allows about sixty chains per window; edit lib/scanUniverse.ts to change the list.',
    );
  }

  const { rows, rolledOff, uncomparableSymbols } =
    current && previous
      ? diff(current, previous)
      : { rows: [], rolledOff: [], uncomparableSymbols: [] };

  if (uncomparableSymbols.length > 0) {
    notes.push(
      `${uncomparableSymbols.length} symbols were not read on both days, so they are ` +
        `left out of the comparison rather than shown as vanishing: ${uncomparableSymbols.join(', ')}.`,
    );
  }

  return {
    rows: rows.slice(0, MAX_ROWS),
    rolledOff: rolledOff.slice(0, MAX_ROWS),
    rolledOffTotal: rolledOff.length,
    expiredTotal: rolledOff.filter((r) => r.rollOff === 'expired').length,
    currentDate: current?.date ?? '',
    previousDate: previous?.date ?? null,
    capturedAt: current?.capturedAt ?? '',
    symbols: current?.symbols.length ?? 0,
    universe: current?.universe ?? scanSymbolCount(),
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
/** Newest stored snapshot, for the health check. Never computes. */
export async function peekVelocity(): Promise<VelocitySnapshot | null> {
  const stored = await store.read().catch(() => null);
  if (!stored || stored.snapshots.length === 0) return null;
  return newestFirst(stored.snapshots)[0];
}

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
