'use client';

import type { AutoRefreshState } from '@/hooks/useAutoRefresh';

/**
 * The freshness chip that sits in a page header: when the numbers last updated,
 * and a button to update them now.
 *
 * ## Two modes, one component, on purpose
 *
 * Live pages refetch on a timer and this ticks with them. Pages fed by
 * cron-written storage cannot be refreshed from the browser — nothing the
 * reader does moves the numbers until the cron next fires — so on those the
 * same chip renders read-only: one muted line saying so, no button and no
 * spinner. Using one component for both keeps the "can I refresh this"
 * affordance in the same place and shape on every page.
 *
 * ## Why read-only does not repeat the timestamp
 *
 * The blob-backed pages already print their last-run stamp in the header, so a
 * second copy here would be noise. The read-only chip carries only what the
 * header does *not* say — that there is no live loop and the numbers wait on
 * the job — which is the one thing a reader looking for a refresh button needs
 * to be told. Provenance stays with `AsOfStamp` and the header; this vouches
 * for the refetch loop, or says there isn't one.
 */

function formatClock(date: Date): string {
  // Local time, HH:MM:SS, zero-padded. The reader's own clock is the one that
  // answers "is this current for me right now".
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

const WRAP_CLASS =
  'flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-term-faint';

/**
 * Read-only: a cron-written page. One line, nothing interactive — there is
 * nothing a click here could do, and the header already carries the stamp.
 */
export function RefreshStatus(
  props:
    | (Pick<AutoRefreshState, 'lastUpdated' | 'isRefreshing' | 'error'> & {
        readOnly?: false;
        onRefresh: () => void;
      })
    | { readOnly: true },
): React.ReactElement {
  if (props.readOnly) {
    return (
      <div className={WRAP_CLASS}>
        <span className="text-term-faint">Refreshes when the job next runs</span>
      </div>
    );
  }

  const { lastUpdated, isRefreshing, error, onRefresh } = props;

  return (
    <div className={WRAP_CLASS}>
      <span className="label-xs text-term-dim">Updated</span>
      <span className="tabular-nums text-term-dim">
        {lastUpdated ? formatClock(lastUpdated) : '—'}
      </span>

      {error && (
        // The data on screen is still the last good reading — say the update
        // failed, do not imply the numbers are gone.
        <span className="text-term-faint">· last update failed</span>
      )}

      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label="Refresh now"
        className="ml-0.5 border border-term-line px-1.5 py-0.5 text-2xs text-term-dim transition-colors hover:border-term-edge hover:text-term-text disabled:cursor-default disabled:opacity-60"
      >
        {isRefreshing ? (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-term-line border-t-term-text"
            />
            Refreshing
          </span>
        ) : (
          'Refresh'
        )}
      </button>
    </div>
  );
}
