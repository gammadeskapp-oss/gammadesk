import 'server-only';

import { after } from 'next/server';

/**
 * Run a cache-populating task after the current response has been sent.
 *
 * The `peek*` entry points return null when a snapshot cache is empty so the
 * page can render "Updating…" instead of blocking on a cold compute. Something
 * still has to fill that cache, and a bare `void fn()` promise can be torn down
 * when the serverless function returns — which on a weekend (no refresher cron)
 * would leave the page stuck on "Updating…" forever. `after` defers the work to
 * run reliably once the response is flushed, within the same invocation budget,
 * so the next load is warm.
 *
 * Falls back to a detached promise if `after` is unavailable (e.g. called
 * outside a request scope), and never throws — a failed populate only means the
 * next request tries again.
 */
export function schedulePopulate(task: () => Promise<unknown>): void {
  try {
    after(async () => {
      try {
        await task();
      } catch {
        // Best-effort: the next request (or the refresher cron) will retry.
      }
    });
  } catch {
    void task().catch(() => {});
  }
}
