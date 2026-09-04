'use client';

import { useCallback, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { RefreshStatus } from '@/components/RefreshStatus';

/**
 * Wires {@link useAutoRefresh} to a server-rendered page and renders its
 * {@link RefreshStatus} chip. Drop one next to a page's header to make its
 * numbers refresh themselves.
 *
 * ## Why `router.refresh` and not a fetch
 *
 * Every data page here is a server component: it computes its reading on the
 * server and hands the result to client boards as props. There is no client
 * fetch to repeat. `router.refresh()` re-runs that server render and streams
 * the new payload in, merging it under the existing client state without a
 * full reload — exactly the refetch this needs, and the only one that keeps
 * the server as the single place the numbers are computed.
 *
 * ## Making a void call awaitable
 *
 * `router.refresh()` returns nothing, so on its own the hook could never tell
 * when a refetch finished or whether one was still running. Wrapping it in a
 * transition fixes that: `isPending` stays true until the new server render has
 * arrived and committed, and the effect below resolves the refetch promise on
 * the exact edge it clears. That is what lets the hook's overlap guard and its
 * "only stamp on success" both work against a re-render rather than a fetch.
 */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Holds the current refetch's resolver until the transition finishes.
  const resolverRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isPending && resolverRef.current) {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve();
    }
  }, [isPending]);

  const refetch = useCallback(
    () =>
      new Promise<void>((resolve) => {
        resolverRef.current = resolve;
        startTransition(() => {
          router.refresh();
        });
      }),
    [router],
  );

  const { lastUpdated, isRefreshing, error, refresh } = useAutoRefresh(
    refetch,
    intervalMs,
  );

  return (
    <RefreshStatus
      lastUpdated={lastUpdated}
      // `isPending` is the truer in-flight signal for the button's spinner; the
      // hook's own flag covers the gap before the transition starts.
      isRefreshing={isRefreshing || isPending}
      error={error}
      onRefresh={refresh}
    />
  );
}
