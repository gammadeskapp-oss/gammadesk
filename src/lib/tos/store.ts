import 'server-only';

import { createJsonStore, storeStatus } from '../jsonStore';
import { applyTrendChange, type TrendAction } from './parse';
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
function emptyList(): TrendList {
  return { symbols: [], addedAt: {}, updatedAt: null, lastCheckedAt: null, lastError: null };
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

    return {
      symbols,
      addedAt,
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
      lastCheckedAt: typeof doc.lastCheckedAt === 'string' ? doc.lastCheckedAt : null,
      lastError: typeof doc.lastError === 'string' ? doc.lastError : null,
    };
  },
);

export async function readTrend(): Promise<TrendList> {
  return store.read();
}

/**
 * Apply one add/remove and persist it, maintaining `addedAt` and stamping
 * `updatedAt` only when the set of symbols actually changed. Returns the list
 * after the write plus whether it moved — the poll logs only real changes, so
 * a re-delivered alert stays quiet.
 */
export async function applyChange(
  action: TrendAction,
  symbols: readonly string[],
  now: Date = new Date(),
): Promise<{ list: TrendList; changed: boolean }> {
  let changed = false;
  const list = await store.update((current) => {
    const nextSymbols = applyTrendChange(current.symbols, action, symbols);
    changed =
      nextSymbols.length !== current.symbols.length ||
      nextSymbols.some((s, i) => s !== current.symbols[i]);
    if (!changed) return current;

    const stamp = now.toISOString();
    const addedAt: Record<string, string> = {};
    for (const symbol of nextSymbols) {
      // Preserve an existing first-seen time; stamp genuinely new symbols now.
      addedAt[symbol] = current.addedAt[symbol] ?? stamp;
    }

    return { ...current, symbols: nextSymbols, addedAt, updatedAt: stamp };
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
