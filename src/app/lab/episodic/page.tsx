import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EpisodicBoard } from '@/components/EpisodicBoard';
import { EpisodicCalibrationPanel } from '@/components/EpisodicCalibrationPanel';
import { EpisodicFindingList } from '@/components/EpisodicFindingList';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { getEpisodicView } from '@/lib/episodic';
import { episodicEnabled } from '@/lib/episodic/flag';
import { formatAsOf } from '@/lib/time';

/**
 * The episodic-pivot scanner — a module of /lab, gated and unlisted exactly as
 * the rest of it is.
 *
 * `noindex, nofollow` overrides the site-wide default, and nothing in the
 * navigation links here. Like the ranking testbed at /lab it refuses to exist
 * without `GAMMADESK_LAB=1`, and the gate is a 404 rather than a 403 so a stray
 * production request cannot even confirm the route is there. The endpoint that
 * spends the bar budget carries the cron auth separately, underneath this.
 */
export const metadata: Metadata = {
  title: 'Episodic pivots',
  description: 'A watchlist builder for stocks that gapped up from a quiet base. Not an entry signal.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function EpisodicPage() {
  // A disabled page must not read the store or do any work.
  if (!episodicEnabled()) notFound();

  const view = await getEpisodicView();

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {/*
          First thing on the page, and it is the whole disclaimer: this builds a
          watchlist and nothing more. A reader arriving at a ranked table of
          tickers should read that before a single row.
        */}
        <div className="panel border-l-2 border-l-flip px-3.5 py-2.5 text-xs leading-relaxed">
          <p className="font-bold text-flip">
            A watchlist builder, not an entry signal.
          </p>
          <p className="mt-1 text-term-dim">
            This finds stocks that were flat and ignored and then gapped up hard on heavy volume —
            an episodic pivot — and then tracks what each one has done since. It is a place to start
            looking, not a decision. There is no buy or sell language anywhere on it, no alert, no
            fixed daily count and no record of how any name worked out. Some days it surfaces
            nothing, and that is a real reading.
          </p>
        </div>

        <PageBar
          title="Episodic pivots"
          description="Flat, ignored, then a hard gap up on volume — and what each name has done since."
          meta={
            view.scanDate
              ? view.mode === 'backfill' && view.calibration
                ? `${view.findings.length} findings · ${view.calibration.months}-month backfill`
                : `${view.findings.length} tracked · ${view.scanDate} scan`
              : 'Nothing stored'
          }
          asOfLabel={view.scannedAt ? formatAsOf(new Date(view.scannedAt)) : undefined}
        />

        {!view.storeDurable && view.storeNote && (
          <div className="panel border-l-2 border-l-neg px-3.5 py-2.5 text-2xs leading-relaxed text-term-dim">
            {view.storeNote}
          </div>
        )}

        {view.notes.length > 0 && (
          <ul className="panel space-y-1 px-3.5 py-2.5 text-2xs leading-relaxed text-term-faint">
            {view.notes.map((note) => (
              <li key={note}>— {note}</li>
            ))}
          </ul>
        )}

        {view.mode === 'backfill' && view.calibration && (
          <EpisodicCalibrationPanel cal={view.calibration} />
        )}

        {view.scanDate ? (
          <EpisodicBoard view={view} />
        ) : (
          <div className="panel px-4 py-10 text-center text-xs">
            <p className="font-bold text-term-text">Nothing to show.</p>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
              This page reads a stored scan and never computes one — a page view here must not spend
              the bar budget. No scan is stored, so there is nothing to rank. It populates once the
              scan job has run.
            </p>
          </div>
        )}

        {view.mode === 'backfill' && view.trendRemoved.length > 0 && (
          <section className="panel px-3.5 py-3">
            <h2 className="label-xs text-term-text">Removed by the base-trend filter</h2>
            <p className="mt-1 text-2xs leading-relaxed text-term-dim">
              These cleared every other rule but were rejected because their base fit a clean rising
              line — already moving, not flat and ignored. Open a few and check the shape: a rising
              channel into the gap is a correct reject; a flat base here would mean the filter is too
              aggressive. {view.trendRemoved.length} shown (capped).
            </p>
            <div className="mt-2">
              <EpisodicFindingList findings={view.trendRemoved} />
            </div>
          </section>
        )}

        {/* The pause tracker is the important half — say what its columns mean. */}
        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">Reading the pause tracker</h2>
          <p className="mt-1.5 text-term-dim">
            The gap is the event; the pause is what tells you whether the market is still holding
            the stock. <span className="text-term-text">Held</span> is whether every close since the
            gap has stayed at or above the midpoint of the gap day&rsquo;s range — a break flags the
            name dead, and it stays on the list flagged rather than being hidden.{' '}
            <span className="text-term-text">Last-5</span> is how tight the last five sessions are:
            tightening is the constructive shape. <span className="text-term-text">Vol 5/20</span>{' '}
            is the last five sessions&rsquo; volume against the trailing twenty — under one means it
            is drying up, which is what a healthy pause looks like. <span className="text-term-text">
              Range hi
            </span>{' '}
            is the top of that tight range, a reference level and nothing more. Sort by tightening to
            bring the coiling names to the top.
          </p>
        </section>

        {/* How it is built — the same honesty the rest of /lab carries. */}
        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">How this is built</h2>

          <p className="mt-1.5">
            <span className="text-term-dim">It reads a stored scan and nothing else. </span>
            The scan pulls a year of daily bars across the whole listed common-stock universe — not
            just the S&amp;P 500 — finds the pattern, and writes a document. This page reads that
            document, so opening it costs the upstream nothing. The scan is a separate, flag-gated,
            local-only job.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The universe is walked in slices, and findings accumulate across runs.{' '}
            </span>
            A year of bars for thousands of names is too much for one request budget to always
            finish, so a run takes as much as it can and the next resumes where it stopped. A name
            appears once its slice has been scanned, and a finding is dropped once its gap ages out
            or it has not been re-confirmed in a fortnight.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">The thresholds move, but only so far. </span>
            The scan keeps every survivor of a wide capture net; the sliders tighten that in your
            browser and can loosen back down to the capture floor, but no further. A genuinely wider
            search is the one thing that needs the scan to run again — which a page view is not
            allowed to trigger.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">Every judgment call is listed, not buried. </span>
            The defaults are the spec&rsquo;s numbers; the decisions made around the edges of the
            spec are below.
          </p>
        </section>

        {view.caveats.length > 0 && (
          <details className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
            <summary className="cursor-pointer label-xs">Decisions and data gaps</summary>
            <ul className="mt-1.5 space-y-1">
              {view.caveats.map((c) => (
                <li key={c}>— {c}</li>
              ))}
            </ul>
          </details>
        )}
      </main>

      <Footer />
    </>
  );
}
