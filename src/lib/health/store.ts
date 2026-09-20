import 'server-only';

import { createJsonStore, storeStatus } from '../jsonStore';
import { trimHistory, type HealthReport } from './report';

/**
 * Durable storage for the nightly health check's last 30 days of results.
 *
 * Lives in Vercel Blob like the rest of the app's stored state so the history
 * survives redeploys between the once-a-day runs. Same-date re-runs overwrite,
 * and only the most recent 30 days are kept.
 */

export { storeStatus };

const KEEP_DAYS = 30;

const historyStore = createJsonStore<HealthReport[]>(
  'gammadesk/health-nightly.json',
  () => [],
  (raw) => (Array.isArray(raw) ? (raw as HealthReport[]) : null),
);

/** The stored reports, newest first. Never throws. */
export async function readHealthHistory(): Promise<HealthReport[]> {
  return historyStore.read().catch(() => []);
}

/** Add today's report, overwriting a same-date entry, keeping 30 days. */
export async function appendHealthReport(report: HealthReport): Promise<void> {
  await historyStore.update((current) => trimHistory(current, report, KEEP_DAYS));
}
