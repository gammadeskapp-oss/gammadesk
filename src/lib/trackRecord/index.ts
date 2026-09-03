import 'server-only';

import { config } from '../config';
import { storeStatus, type StoreStatus } from '../jsonStore';
import { readTrackRecord } from './store';
import {
  summariseTrackRecord,
  type TrackRecordEntry,
  type TrackRecordSummary,
} from './types';

export { readTrackRecord } from './store';
export { logTodaysPicks, LOGGED_PER_DAY } from './log';
export { settleTrackRecord } from './settle';
export * from './types';

/**
 * The read path for /trackrecord.
 *
 * Reads storage and nothing else — no fetching, no settling on demand. A page
 * view that filled in a forward return would be doing the job's work at a time
 * the job did not choose, and the one thing this record cannot afford is a
 * write path nobody scheduled.
 */
export interface TrackRecordView {
  /** Every logged pick, newest first. Never filtered — see `types.ts`. */
  entries: TrackRecordEntry[];
  summary: TrackRecordSummary;
  /** Wall-clock times the two jobs are scheduled for, from config. */
  schedule: { logEt: string; settleEt: string };
  store: StoreStatus;
}

export async function getTrackRecordView(): Promise<TrackRecordView> {
  const entries = await readTrackRecord().catch(() => []);

  return {
    entries,
    summary: summariseTrackRecord(entries),
    schedule: {
      logEt: config.trackRecord.logTimeEt,
      settleEt: config.trackRecord.settleTimeEt,
    },
    store: storeStatus(),
  };
}
