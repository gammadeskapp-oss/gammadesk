import 'server-only';

import { createJsonStore, storeStatus } from '../jsonStore';
import type { NewsScanResult } from './types';

/**
 * Durable storage for the news scanner.
 *
 * Each scan overwrites its own market day; the store keeps the last few days so
 * a missed morning is still readable and the owner console can show recent
 * history. Lives in Vercel Blob in production (survives redeploys) and falls
 * back to a JSON file locally — the same pattern as every other stored document
 * here. See `lib/jsonStore`.
 */

export { storeStatus };

/** Days of scans kept. Enough for the console and a working week of review. */
const KEEP_DAYS = 10;

type NewsArchive = Record<string, NewsScanResult>;

function isResult(v: unknown): v is NewsScanResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as NewsScanResult;
  return typeof r.date === 'string' && Array.isArray(r.top) && Array.isArray(r.ranked);
}

const store = createJsonStore<NewsArchive>(
  'gammadesk/news.json',
  () => ({}),
  (raw) => {
    if (!raw || typeof raw !== 'object') return {};
    const out: NewsArchive = {};
    for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && isResult(value)) out[date] = value;
    }
    return out;
  },
);

/** Persist one day's scan, pruning anything older than KEEP_DAYS by date. */
export async function saveScan(result: NewsScanResult): Promise<void> {
  await store.update((current) => {
    const next: NewsArchive = { ...current, [result.date]: result };
    const dates = Object.keys(next).sort().reverse().slice(0, KEEP_DAYS);
    const keep = new Set(dates);
    for (const date of Object.keys(next)) {
      if (!keep.has(date)) delete next[date];
    }
    return next;
  });
}

/** The scan for a specific market date, or null. */
export async function readScanForDate(date: string): Promise<NewsScanResult | null> {
  const archive = await store.read().catch(() => ({} as NewsArchive));
  return archive[date] ?? null;
}

/** The most recent stored scan, or null when nothing has run yet. */
export async function readLatestScan(): Promise<NewsScanResult | null> {
  const archive = await store.read().catch(() => ({} as NewsArchive));
  const dates = Object.keys(archive).sort().reverse();
  return dates.length ? archive[dates[0]] : null;
}

/** Every stored scan, newest first — for the owner console. */
export async function readAllScans(): Promise<NewsScanResult[]> {
  const archive = await store.read().catch(() => ({} as NewsArchive));
  return Object.keys(archive)
    .sort()
    .reverse()
    .map((d) => archive[d]);
}
