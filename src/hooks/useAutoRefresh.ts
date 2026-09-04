'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Five minutes, for pages fed by the delayed market feeds (Polygon grouped
 * daily, the Cboe chain, daily bars). That data is fifteen minutes behind the
 * tape, so a tighter loop spends upstream requests to redraw numbers that have
 * not moved. Five minutes keeps a left-open page current within a bar without
 * touching the quota faster than the data changes.
 */
export const DELAYED_FEED_REFRESH_MS = 5 * 60 * 1000;

/**
 * One minute, for /lab only. Its price column is a live Tradier quote read
 * seconds ago, and that feed exists only on a local machine with a token set —
 * so this cadence is never paid in production, where the page 404s.
 */
export const LIVE_FEED_REFRESH_MS = 60 * 1000;

/**
 * The state a `<RefreshStatus />` reads and the manual trigger it calls.
 *
 * `lastUpdated` is the last *successful* refetch, never the last attempt — see
 * the hook body for why the two are kept apart.
 */
export interface AutoRefreshState {
  lastUpdated: Date | null;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => void;
}

export interface AutoRefreshOptions {
  /**
   * Arm the timer. Off leaves every field inert and fires nothing — a page can
   * gate the whole mechanism behind a flag without unmounting the component.
   */
  enabled?: boolean;
}

/**
 * Refetch a page's live numbers on an interval, but only while someone is
 * looking at them.
 *
 * ## Why the tab has to be visible
 *
 * A background tab left open overnight would otherwise keep firing the same
 * request every few minutes at data that only moves during market hours. So
 * the interval runs only while `document.visibilityState` is `visible`. Hiding
 * the tab clears it; showing it again fires one immediate refetch (the numbers
 * are however stale the tab was hidden) and then restarts the interval from
 * that moment. The alternative — a timer that keeps running while hidden — is
 * how a page nobody is reading quietly becomes the biggest consumer of a
 * shared upstream quota.
 *
 * ## Why overlapping calls are dropped, not queued
 *
 * A refetch here re-runs a whole server component, which on a slow upstream can
 * outlast the interval. Queuing the next tick behind it would let a backlog of
 * refetches build up and fire in a burst the moment the slow one returned.
 * Instead a tick that arrives while one is still in flight is dropped: the next
 * scheduled tick will catch up, and the reader loses nothing but one redundant
 * redraw. The guard is a ref rather than the `isRefreshing` state because state
 * updates are not synchronous and two ticks in the same frame would both see
 * the old value.
 *
 * ## Why a failed refetch does not blank the numbers
 *
 * `lastUpdated` only advances on success, and a thrown refetch sets `error`
 * while leaving both `lastUpdated` and — crucially — whatever is already
 * rendered untouched. A page showing a five-minute-old reading with a quiet
 * "last update failed" note is telling the truth; a page that clears itself to
 * an error state on one dropped request is discarding good data over a blip.
 */
export function useAutoRefresh(
  refetchFn: () => void | Promise<void>,
  intervalMs: number,
  options: AutoRefreshOptions = {},
): AutoRefreshState {
  const { enabled = true } = options;

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // The caller passes a fresh closure every render; hold the latest in a ref so
  // the interval effect does not tear down and rearm on each parent render.
  // Written in an effect, not during render — a ref is not render output.
  const refetchRef = useRef(refetchFn);
  useEffect(() => {
    refetchRef.current = refetchFn;
  }, [refetchFn]);

  // The overlap guard. A ref, so two ticks in one frame cannot both pass it.
  const inFlightRef = useRef(false);

  const run = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      await refetchRef.current();
      // Success, and only success, moves the clock.
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      // Keep the old timestamp and the data on screen; just note the failure.
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(() => void run(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void run();
        start();
      } else {
        stop();
      }
    };

    // Arm only if the tab is already visible; a page opened in a background tab
    // waits for its first `visibilitychange` before it fires anything. The
    // server already rendered a fresh reading, so mounting does not refetch —
    // the first tick lands one interval from now.
    if (document.visibilityState === 'visible') {
      start();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [enabled, intervalMs, run]);

  const refresh = useCallback(() => void run(), [run]);

  return { lastUpdated, isRefreshing, error, refresh };
}
