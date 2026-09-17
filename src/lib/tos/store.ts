import 'server-only';

import { createJsonStore, storeStatus } from '../jsonStore';
import { applyTrendOps, type TrendOp } from './parse';
import type { TrendList } from './types';

export { storeStatus };

/**
 * Where the Trend list lives.
 *
 * Uses the same durable JSON store as every other stored document here: Vercel
 * Blob in production (the same helper the accuracy log and session history
 * use), and a JSON file under `.gammadesk/` locally, which is git-ignored.
 *
 * The blob is private. `createJsonStore` writes with `access: 'private'` first
 * and reads back through the authenticated `get`, never a public URL — so the
 * list is not fetchable by anyone who guesses the path, which matters because
 * this is owner-only data.
 */

/** How many processed-email IDs to remember. Far more than a day of alerts. */
const MAX_PROCESSED_IDS = 500;

function emptyList(): TrendList {
  return {
    symbols: [],
    addedAt: {},
    updatedAt: null,
    lastCheckedAt: null,
    lastError: null,
    processedIds: [],
  };
}

const store = createJsonStore<TrendList>(
  'gammadesk/tos-trend.json',
  emptyList,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as Partial<TrendList>;
    if (!Array.isArray(doc.symbols) || !doc.symbols.every((s) => typeof s === 'string')) {
      return null;
    }
    const symbols = [...new Set(doc.symbols.map((s) => s.toUpperCase()))].sort();

    // Keep only addedAt entries whose symbol is still present.
    const addedAt: Record<string, string> = {};
    if (doc.addedAt && typeof doc.addedAt === 'object') {
      for (const symbol of symbols) {
        const at = (doc.addedAt as Record<string, unknown>)[symbol];
        if (typeof at === 'string') addedAt[symbol] = at;
      }
    }

    const processedIds = Array.isArray(doc.processedIds)
      ? doc.processedIds.filter((id): id is string => typeof id === 'string')
      : [];

    return {
      symbols,
      addedAt,
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
      lastCheckedAt: typeof doc.lastCheckedAt === 'string' ? doc.lastCheckedAt : null,
      lastError: typeof doc.lastError === 'string' ? doc.lastError : null,
      processedIds,
    };
  },
);

export async function readTrend(): Promise<TrendList> {
  return store.read();
}

export interface ApplyEmailResult {
  list: TrendList;
  /** Whether the set of symbols actually changed. */
  changed: boolean;
}

/**
 * Handle one email atomically: record its ID as processed, apply its Trend
 * operations in order, and — because it was a Trend alert — stamp `updatedAt`
 * even if the resulting list is identical.
 *
 * This is one Blob write. The caller marks the email read (and treats it as
 * done) only after this resolves, so a failed write leaves the email to be
 * retried on the next run rather than silently lost.
 *
 * @param id   The email's stable identifier (Message-ID, or a uid fallback).
 * @param ops  The Trend add/remove operations, in document order. May be empty
 *             for an alert about another scan — the ID is still recorded so it
 *             is not re-examined, but the list and `updatedAt` are untouched.
 */
export async function applyEmail(
  id: string,
  ops: readonly TrendOp[],
  now: Date = new Date(),
): Promise<ApplyEmailResult> {
  let changed = false;
  const list = await store.update((current) => {
    const nextSymbols = applyTrendOps(current.symbols, ops);
    changed =
      nextSymbols.length !== current.symbols.length ||
      nextSymbols.some((s, i) => s !== current.symbols[i]);

    const stamp = now.toISOString();

    const addedAt: Record<string, string> = {};
    for (const symbol of nextSymbols) {
      addedAt[symbol] = current.addedAt[symbol] ?? stamp;
    }

    // Record the ID (dedupe, bound to the most recent MAX_PROCESSED_IDS).
    const processedIds = current.processedIds.includes(id)
      ? current.processedIds
      : [...current.processedIds, id].slice(-MAX_PROCESSED_IDS);

    return {
      ...current,
      symbols: nextSymbols,
      addedAt,
      // A Trend alert (ops present) always freshens "Last updated", even when
      // the list is unchanged. An other-scan alert (no ops) does not.
      updatedAt: ops.length > 0 ? stamp : current.updatedAt,
      processedIds,
    };
  });
  return { list, changed };
}

/**
 * Record that a poll ran, whether or not it changed anything. `error` is the
 * message from a failed run, or null on success.
 */
export async function markChecked(
  error: string | null,
  now: Date = new Date(),
): Promise<TrendList> {
  return store.update((current) => ({
    ...current,
    lastCheckedAt: now.toISOString(),
    lastError: error,
  }));
}
