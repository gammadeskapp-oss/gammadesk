import 'server-only';

import { createJsonStore } from '../jsonStore';

/**
 * A one-line record of the last date the daily brief was emailed.
 *
 * This is operational state, not subscriber data — it holds no addresses, only
 * a date — so it is fine to keep in our own Blob store. Its whole job is to stop
 * the twin cron entries (one for each UTC hour across DST) from sending the
 * brief twice on the same trading day.
 */

interface SentMarker {
  lastSentDate: string | null;
}

const store = createJsonStore<SentMarker>(
  'gammadesk/email-brief-sent.json',
  () => ({ lastSentDate: null }),
  (raw) => (raw && typeof raw === 'object' ? (raw as SentMarker) : null),
);

export async function alreadySentToday(date: string): Promise<boolean> {
  const marker = await store.read().catch(() => ({ lastSentDate: null }));
  return marker.lastSentDate === date;
}

export async function markSent(date: string): Promise<void> {
  await store.write({ lastSentDate: date }).catch(() => {});
}
