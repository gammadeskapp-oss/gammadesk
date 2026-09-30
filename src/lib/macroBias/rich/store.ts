import 'server-only';

import { createJsonStore } from '../../jsonStore';
import type { RichMacroBias, RichMacroHistoryEntry } from './types';

export { storeStatus } from '../../jsonStore';

/**
 * The −5…+5 Macro Bias record: today's reading plus an append-only daily
 * history, kept in Vercel Blob beside the other stored reads.
 *
 * `current` is the latest computed day; `history` is the prior days, newest
 * first, capped at `HISTORY_KEEP`. The series starts on the day this ships —
 * there is no backfill, because the drivers' day-over-day states and the
 * "what changed" lines can only be computed from records we actually took
 * (see the session-history store for the same reasoning).
 *
 * The card reads this and only this — never FRED on page load. Keeping the last
 * good record here is also what lets a failed refresh degrade to yesterday's
 * numbers rather than blanking the card.
 */

const SCHEMA = 1;
export const HISTORY_KEEP = 30;

export interface RichMacroDoc {
  schema: number;
  current: RichMacroBias;
  /** Prior days, newest first. */
  history: RichMacroHistoryEntry[];
  updatedAt: string;
}

const store = createJsonStore<RichMacroDoc | null>(
  'gammadesk/macro-bias-rich.json',
  () => null,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as RichMacroDoc;
    if (doc.schema !== SCHEMA || !doc.current || typeof doc.current !== 'object') return null;
    if (!Array.isArray(doc.history)) return null;
    return doc;
  },
);

export async function readRichMacroDoc(): Promise<RichMacroDoc | null> {
  return store.read();
}

export async function writeRichMacroDoc(
  current: RichMacroBias,
  history: RichMacroHistoryEntry[],
): Promise<RichMacroDoc> {
  const doc: RichMacroDoc = {
    schema: SCHEMA,
    current,
    history: history.slice(0, HISTORY_KEEP),
    updatedAt: new Date().toISOString(),
  };
  await store.write(doc);
  return doc;
}
