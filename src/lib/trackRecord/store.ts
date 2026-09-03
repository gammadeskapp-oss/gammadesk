import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { StoredTrackRecord, TrackRecordEntry } from './types';

/**
 * Where the scanner's picks live.
 *
 * ## Append-only, and never trimmed
 *
 * Every other store here keeps a window — five days of scans, ninety days of
 * archive — because the old documents stop answering anything. This one is the
 * opposite: its whole value is length. Trimming it would quietly shorten the
 * sample the page reports, which is the number a reader is being asked to
 * judge everything else by.
 *
 * The size is not a concern at the rate it grows. Five entries a session, a
 * few hundred bytes each, is under a megabyte a decade.
 *
 * ## It starts the day it is deployed
 *
 * There is no backfill and there cannot be one. Reconstructing which names the
 * scanner *would* have picked on past mornings means scoring them with the
 * benefit of knowing what happened next, and every such reconstruction in the
 * history of this kind of tool has flattered the tool. The page states the
 * start date rather than implying a longer history.
 */
export const trackRecordStore = createJsonStore<StoredTrackRecord>(
  'gammadesk/scanner-track-record.json',
  () => ({ entries: [] }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const entries = (raw as StoredTrackRecord).entries;
    if (!Array.isArray(entries)) return null;
    return { entries: entries.filter(isEntry) };
  },
);

/**
 * A stored row this code can read back.
 *
 * Deliberately permissive about `forward`: horizons are added over the days
 * following a pick, so an entry with none of them yet is perfectly valid and
 * must survive the round trip. It is strict about the identity fields, because
 * an entry without a symbol and a date cannot be settled or displayed and
 * would sit in the record forever as an unfillable row.
 */
function isEntry(value: unknown): value is TrackRecordEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as TrackRecordEntry;
  return (
    typeof entry.symbol === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.score === 'number' &&
    !!entry.forward &&
    typeof entry.forward === 'object'
  );
}

/** Every logged pick, newest session first. */
export async function readTrackRecord(): Promise<TrackRecordEntry[]> {
  const stored = await trackRecordStore.read().catch(() => null);
  return [...(stored?.entries ?? [])].sort(
    (a, b) => b.date.localeCompare(a.date) || a.rank - b.rank,
  );
}
