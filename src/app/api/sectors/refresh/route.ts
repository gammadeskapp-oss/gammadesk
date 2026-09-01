import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { recordSession } from '@/lib/history/store';
import { refreshSectorsSnapshot, storeStatus } from '@/lib/sectors';
import type { SectorsSnapshot } from '@/lib/sectors/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Recomputes sector momentum and stores it, then freezes the session into the
 * append-only history. Driven by Vercel Cron.
 *
 * Roughly forty daily-bar fetches, then the nine signals recomputed ten times
 * per symbol over slices already in memory — cheap upstream, a little CPU.
 *
 * ## Why the history write lives here and not in the digest job
 *
 * The obvious home was `/api/digest`, ten minutes later. But Vercel Cron fires
 * each entry independently: there is no dependency graph and no completion
 * signal between jobs, so "sectors at 22:10, history at 22:20" is ten minutes
 * of slack, not an ordering guarantee. This route can run for a full minute,
 * and a slow evening would have the history job reading YESTERDAY's snapshot
 * and stamping it as tonight's sector state.
 *
 * Writing it here removes the window rather than timing around it. The
 * snapshot handed to `recordSession` is the object `refreshSectorsSnapshot`
 * just returned, so ordering is program order.
 */
export async function GET(request: Request) {
  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  let snapshot: SectorsSnapshot | null = null;
  let refreshFailure: string | null = null;

  try {
    snapshot = await refreshSectorsSnapshot();
  } catch (error) {
    refreshFailure = error instanceof Error ? error.message : String(error);
  }

  /*
    Recorded whether or not the refresh above worked, and this is the whole
    reason the try/catch is split rather than wrapping both.

    A failed sector refresh must not cost the session its breadth. This series
    cannot be backfilled — a row that is not written tonight is gone for this
    session forever — so a row with a stale-flagged sector half is worth far
    more than no row at all. `recordSession` falls back to the stored snapshot
    when none is passed, which carries its own older `asOfDate` and therefore
    fails `sectorsAreCurrent`; nothing downstream can mistake it for tonight.
  */
  let history: Awaited<ReturnType<typeof recordSession>> | null = null;
  let historyFailure: string | null = null;

  try {
    history = await recordSession(snapshot ? { sectors: snapshot } : {});
  } catch (error) {
    historyFailure = error instanceof Error ? error.message : String(error);
  }

  // Narrowing on the snapshot itself rather than the failure string, so the
  // success path below needs no non-null assertions.
  if (snapshot === null) {
    return NextResponse.json(
      {
        error: 'Sector refresh failed.',
        detail: refreshFailure ?? 'The refresh returned no snapshot.',
        // Reported even on the failure path: whether the session was still
        // recorded is the thing worth knowing when this alerts.
        history: history
          ? { recorded: true, date: history.row.date, sessions: history.sessions }
          : { recorded: false, detail: historyFailure },
        store: storeStatus(),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: 'refreshed',
    asOfDate: snapshot.asOfDate,
    computedAt: snapshot.computedAt,
    sectors: snapshot.sectors.length,
    sessions: snapshot.sessions,
    flagged: snapshot.sectors.filter((s) => s.flag).length,
    notes: snapshot.notes,
    history: history
      ? {
          recorded: true,
          date: history.row.date,
          sessions: history.sessions,
          /*
            Surfaced so a session recorded against a stale sector half is
            visible in the job's own output rather than only discoverable
            months later, when the series is being read back and cannot be
            repaired.
          */
          sectorsAsOf: history.row.sectorsAsOf,
          breadthRecorded: history.row.breadth !== null,
        }
      : { recorded: false, detail: historyFailure },
    store: storeStatus(),
  });
}
