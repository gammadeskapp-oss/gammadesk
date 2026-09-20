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

/**
 * A dedicated probe store, used only to prove Blob is writable. It goes through
 * the same `createJsonStore` write path as everything else — which tries the
 * store's own access mode (private first) and remembers it — so the probe can
 * never disagree with a real write by, say, hard-coding `access: 'public'`
 * against a private store.
 */
const probeStore = createJsonStore<{ at: string }>(
  'gammadesk/_health-probe.json',
  () => ({ at: '' }),
  (raw) => (raw && typeof raw === 'object' ? (raw as { at: string }) : null),
);

/** Write a probe object through the real store path. Throws on failure. */
export async function probeBlobWrite(): Promise<void> {
  await probeStore.write({ at: new Date().toISOString() });
}
