import 'server-only';

import { createJsonStore } from '../jsonStore';
import { getBreadth } from '../breadth';
import { peekStoredSectors } from '../sectors';
import { marketToday } from '../time';
import {
  buildSessionRow,
  upsertRow,
  SESSION_HISTORY_SCHEMA,
  type SessionHistoryRow,
  type StoredSessionHistory,
} from './session';

export { storeStatus } from '../jsonStore';

/**
 * The append-only session series, beside the Accuracy Log in Vercel Blob.
 *
 * See `session.ts` for why it exists and why its shape is permanent.
 */
const store = createJsonStore<StoredSessionHistory>(
  'gammadesk/session-history.json',
  () => ({ schema: SESSION_HISTORY_SCHEMA, rows: [] }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as StoredSessionHistory;
    if (!Array.isArray(doc.rows)) return null;
    /*
      A future schema is refused rather than parsed. Reading a newer document
      with older code and then WRITING it back would silently drop whatever
      fields this build does not know about — and in an append-only series
      those rows cannot be reconstructed.
    */
    if (typeof doc.schema !== 'number' || doc.schema > SESSION_HISTORY_SCHEMA) {
      return null;
    }
    return doc;
  },
);

export async function readSessionHistory(): Promise<SessionHistoryRow[]> {
  const doc = await store.read();
  return doc.rows;
}

export interface RecordResult {
  status: 'recorded';
  row: SessionHistoryRow;
  /** Rows held after this write. */
  sessions: number;
}

/**
 * Freeze today's breadth and sector state into the series.
 *
 * Called at the end of the evening job chain, once the sector refresh has
 * already run — see the note in the digest route. Reads the same two stores
 * every page reads, so it costs two storage reads and no upstream call.
 *
 * Both readings are allowed to fail independently and become null. A row with
 * a null half is still worth writing: it records that this session happened
 * and that the value was unavailable, which is a fact the series needs. A
 * missing row and a null field mean different things, and only one of them can
 * be recovered later.
 */
export async function recordSession(now: Date = new Date()): Promise<RecordResult> {
  const date = marketToday(now);

  const [breadth, sectors] = await Promise.all([
    getBreadth().catch(() => null),
    /*
      `peekStoredSectors`, not `getSectorsSnapshot`. The latter recomputes when
      nothing is stored, which would spend upstream calls from inside a job
      whose whole premise is that it only copies readings other jobs already
      produced. If the refresh failed tonight, the honest record is a null
      sector half — not a second, differently-sourced computation.
    */
    peekStoredSectors().catch(() => null),
  ]);

  const row = buildSessionRow({ date, breadth, sectors, now });
  const doc = await store.update((current) => upsertRow(current, row));

  return { status: 'recorded', row, sessions: doc.rows.length };
}
