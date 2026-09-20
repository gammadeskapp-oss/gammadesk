import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { Brief } from './text';

/**
 * Durable storage for the daily "Morning Desk" brief supplied by the Cowork
 * task (POST /api/brief). One document, overwritten each day; lives in Vercel
 * Blob so it survives redeploys between the morning task's runs.
 */

const store = createJsonStore<Brief | null>(
  'gammadesk/x-brief.json',
  () => null,
  (raw) => {
    if (raw && typeof raw === 'object' && typeof (raw as Brief).date === 'string') {
      return raw as Brief;
    }
    return null;
  },
);

export async function saveBrief(brief: Brief): Promise<void> {
  await store.write(brief);
}

export async function readBrief(): Promise<Brief | null> {
  return store.read().catch(() => null);
}

/** The stored brief only if it is for `date`; otherwise null (stale is unusable). */
export async function readBriefForDate(date: string): Promise<Brief | null> {
  const brief = await readBrief();
  return brief && brief.date === date ? brief : null;
}
