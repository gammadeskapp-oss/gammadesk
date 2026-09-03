import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { LabBoard } from '@/components/LabBoard';
import { PageBar } from '@/components/PageBar';
import { SwingBoard } from '@/components/SwingBoard';
import { getLabView } from '@/lib/lab';
import { getSwingView } from '@/lib/lab/swing';
import { labEnabled } from '@/lib/lab/flag';
import { LAB_ANALOGUE_HORIZON } from '@/lib/lab/types';
import { formatAsOf } from '@/lib/time';

/**
 * Unlisted, and switched off unless somebody switched it on.
 *
 * `noindex, nofollow` overrides the site-wide `index, follow` from the root
 * layout and nothing in the navigation links here, the same treatment
 * `/previousscanner` gets. Unlike that page, this one also refuses to exist
 * without `GAMMADESK_LAB=1`: an unvalidated ranking of five hundred tickers is
 * not something to leave reachable by anyone who guesses a URL on a deploy
 * that happened to contain it.
 *
 * The gate is a 404 rather than a 403, because a 403 confirms the route is
 * there — see `lib/lab/flag.ts`. It is a switch and not authentication; the
 * endpoint that spends upstream requests carries the cron auth separately. If
 * this ever needs to be readable in production by one person, the way to do
 * that is a passcode from an environment variable, checked here before
 * anything renders.
 */
export const metadata: Metadata = {
  title: 'Lab',
  description: 'A private testbed for a combined score. Not a scanner.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function LabPage() {
  // Before any work: a disabled page must not read stores or do arithmetic.
  if (!labEnabled()) notFound();

  const [view, swing] = await Promise.all([getLabView(), getSwingView()]);

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {/*
          First thing on the page. Everything below it is an experiment whose
          result is not in yet, and a reader arriving at a ranked table of
          tickers should be told that before they read a single row.
        */}
        <div className="panel border-l-2 border-l-flip px-3.5 py-2.5 text-xs leading-relaxed">
          <p className="font-bold text-flip">
            Testbed. Nothing here has been validated against anything.
          </p>
          <p className="mt-1 text-term-dim">
            This page exists to answer one question by eye over a few days: does
            blending these six readings into a single number surface names the
            individual pages would not have, or does it reshuffle the same list?
            Until that question has an answer, the ordering below is a
            hypothesis with a table around it. The pages the components come
            from — <a href="/scanner" className="underline decoration-dotted hover:text-term-text">/scanner</a>,{' '}
            <a href="/strength" className="underline decoration-dotted hover:text-term-text">/strength</a>,{' '}
            <a href="/flow" className="underline decoration-dotted hover:text-term-text">/flow</a> and{' '}
            <a href="/analogues" className="underline decoration-dotted hover:text-term-text">/analogues</a>{' '}
            — each say what their own numbers mean, and none of them says this.
          </p>
        </div>

        {/*
          The swing candidate engine. Above the ranking testbed because it is a
          different kind of thing: not a reordering of the whole index, but a
          set of names where a fixed list of independent checks all agree at
          once. It reuses the existing engines and rebuilds none of them, and
          it recomputes its trigger and gamma room against the live price on
          every view.
        */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="label-xs text-term-text">Swing candidates</h2>
            <span className="text-2xs text-term-faint">
              {swing.scanDate
                ? `${swing.bullish.length + swing.bearish.length} aligned · ${swing.scanDate} scan${
                    swing.live.available
                      ? ` · live ${swing.live.capturedEt}${swing.live.marketOpen ? '' : ' (closed)'}`
                      : ' · stored closes'
                  }`
                : 'Nothing stored'}
            </span>
          </div>

          <div className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-term-faint">
            <p className="text-term-dim">
              An alignment read, not a prediction. Every card is a name where
              SPY&rsquo;s regime, its sector strength, its 20/50/200 trend, its
              relative strength, a live trigger (20-EMA reclaim, breakout or
              tight consolidation) and its volume all point the same way at
              once. The ticks say how many agree; the number is
              never odds of anything working. There is no fixed count — every
              name that qualifies is shown, and none that does not. Trigger and
              gamma room are measured against the current Tradier price;
              everything else is a stored reading on its own refresh cadence.
            </p>
          </div>

          {swing.notes.length > 0 && (
            <ul className="panel space-y-1 px-3.5 py-2.5 text-2xs leading-relaxed text-term-faint">
              {swing.notes.map((note) => (
                <li key={note}>— {note}</li>
              ))}
            </ul>
          )}

          {swing.scanDate ? (
            <SwingBoard view={swing} />
          ) : (
            <div className="panel px-4 py-8 text-center text-xs">
              <p className="font-bold text-term-text">Nothing to evaluate.</p>
              <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
                This engine reads the scanner&rsquo;s stored document and never
                computes one. No scan is stored, so there are no names to check.
              </p>
            </div>
          )}

          {swing.caveats.length > 0 && (
            <details className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-term-faint">
              <summary className="cursor-pointer label-xs">
                Decisions and data gaps
              </summary>
              <ul className="mt-1.5 space-y-1">
                {swing.caveats.map((c) => (
                  <li key={c}>— {c}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <PageBar
          title="Lab"
          description="Six stored readings, blended into one ranking over the whole index, at weights you set."
          meta={
            view.scanDate
              ? `${view.rows.length} names · ${view.scanDate} scan`
              : 'Nothing stored'
          }
          asOfLabel={
            view.scannedAt ? formatAsOf(new Date(view.scannedAt)) : undefined
          }
        />

        {/*
          Above the table rather than under it, because it changes how every
          row reads: three of the six components are absent for most of the
          index, and a total blended from two readings looks exactly like one
          blended from six unless something says otherwise.
        */}
        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">What is actually measured</h2>
          <ul className="mt-1.5 space-y-1">
            {view.notes.map((note) => (
              <li key={note}>— {note}</li>
            ))}
          </ul>
          {view.scanDate && (
            <p className="mt-2 text-term-dim">
              Coverage over {view.rows.length} names: gamma regime{' '}
              {view.coverage.gammaRegime}, flip distance{' '}
              {view.coverage.flipDistance}, magnet distance{' '}
              {view.coverage.magnetDistance}, relative strength{' '}
              {view.coverage.rs}, flow {view.coverage.flow}. The analogue hit
              rate is loaded on request and starts at zero every time the page
              opens.
            </p>
          )}
        </section>

        {view.rows.length > 0 ? (
          <LabBoard view={view} />
        ) : (
          <div className="panel px-4 py-10 text-center text-xs">
            <p className="font-bold text-term-text">Nothing to rank.</p>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
              This page reads the scanner&rsquo;s stored document and never
              computes one — a page view here must not be able to spend the
              chain budget. No scan is stored, so there are no readings to
              blend. It will populate once the scanner has run.
            </p>
          </div>
        )}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">How this is built</h2>

          <p className="mt-1.5">
            <span className="text-term-dim">
              It reads stores and it reads nothing else.{' '}
            </span>
            Five of the six components come from documents the scanner, the
            gamma refresh and the flow scan have already written, joined by
            ticker. Opening this page costs the chain providers nothing. The
            sixth — the analogue hit rate — is not stored anywhere and costs a
            full price history per name, so it is fetched in batches only when
            asked for, and is absent until then.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              It ranks the whole universe and never filters it.{' '}
            </span>
            Every name the scan scored is on the list at every setting. There is
            no combination of weights that removes a name, empties the page or
            produces a shortlist. The weights change the order and nothing else,
            which is the only arrangement under which &ldquo;did this surface
            something new&rdquo; is a question the page can answer.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              An absent reading is dropped from the blend, never scored zero.{' '}
            </span>
            Most of the index has no flow reading because the flow scan covers
            around eighty names, and any name without a chain in the last gamma
            refresh has no gamma, flip or magnet reading. Scoring those absences
            as zero would rank the index by which jobs had time for which names
            — a statement about this site&rsquo;s request budget dressed up as a
            statement about the market. So the weights renormalise over what is
            left, and every row prints how many of the six actually took part.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              A covered chain that flagged nothing is a zero, and it is a real
              one.{' '}
            </span>
            The flow component distinguishes a name the scan looked at and found
            nothing unusual on from a name the scan never reached. The first
            scores zero; the second has no reading at all. Collapsing them is
            the same mistake as scoring an absence, one level down.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Relative strength is used exactly as /strength publishes it.{' '}
            </span>
            Rescaling a score a reader can go and look up would make the two
            pages disagree about the same name, and this page is worth nothing
            if its inputs cannot be checked against their source.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The analogue column is one condition, named, not several averaged.{' '}
            </span>
            A name can meet three conditions on the same session, and their
            match sets are overlapping samples of the same days — averaging
            their hit rates produces a number with no meaning. So the active
            condition with the largest elapsed sample at {LAB_ANALOGUE_HORIZON}{' '}
            sessions is used, it is named on the row, and every other active
            condition is listed beside it. A name meeting no condition today has
            no reading rather than a poor one, and a sample under ten matches is
            scored and flagged rather than hidden.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Two of the six are scored in a direction this page chose, and both
              open switched off.{' '}
            </span>
            Distance to the flip and distance to the nearest magnet are both
            scored so that <em>nearer is higher</em>. That is a guess about what
            is worth looking at, not something the data implies — proximity to a
            level is interesting, it is not good, and the opposite sign is just
            as arguable. So both start at weight zero. Their scoring and both
            span constants are unchanged and the sliders reach them normally,
            but a component whose direction nobody has established, left on by
            default, makes every reading of the ranking conditional on a coin
            flip nobody remembers making. Switch them on one at a time and the
            effect of each is visible; switch them on together at the start and
            it never is.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Weights are not saved, and that is deliberate.{' '}
            </span>
            A saved weighting would mean coming back to a ranking assembled by a
            version of yourself who is no longer in the room, under a heading
            that does not mention it. Reloading returns to the defaults above;
            the panel always shows what is currently applied.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              There is no verdict on this page and there is not going to be one.{' '}
            </span>
            A name at the top is the name nothing else scored higher than, at
            weights that were chosen a minute ago, over components that are
            missing for most of the index. That is an ordering. It is not a
            shortlist, it is not a recommendation, and nothing here says what to
            do about any row on it.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
