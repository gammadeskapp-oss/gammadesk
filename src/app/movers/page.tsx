import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { MoversBoard } from '@/components/MoversBoard';
import { PageBar } from '@/components/PageBar';
import { StaleDataBanner } from '@/components/StaleDataBanner';
import { snapshotStaleness } from '@/lib/events';
import { EARNINGS_WARN_DAYS } from '@/lib/movers/rules';
import {
  MIN_RELATIVE_VOLUME,
  MOVERS_EXPLANATION,
  MOVERS_EXPLANATION_LIVE,
  REFRESH_SECONDS,
  getMovers,
} from '@/lib/movers';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { getScannerView } from '@/lib/scanner';
import { DEFAULT_FILTERS, scoreAndJudge } from '@/lib/scanner/score';
import { sessionLabel } from '@/lib/staleness';
import { formatAsOf } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Moved last session',
  description:
    'S&P 500 names that closed up on more than 1.5 times their own average volume in the last completed session, with the context to check each one against. Not a scanner result.',
};

export const dynamic = 'force-dynamic';

export default async function MoversPage() {
  const movers = await getMovers();

  /*
   * The scanner's state, read from its stored document — no scan is run and
   * nothing here can cause one. It is on this page for one reason: a reader
   * who came looking for ideas has to be able to see, on the same screen, that
   * the scanner produced nothing and that these fifteen names are NOT what it
   * produced. Stating both is the only arrangement in which one cannot be
   * mistaken for the other.
   *
   * The reverse is not done. Nothing from this list appears on /scanner,
   * because a movers row under the scanner's heading is the substitution this
   * whole feature is built to avoid.
   */
  const scannerView = await getScannerView().catch(() => null);
  /*
   * Counted at the scanner's shipped defaults, deliberately. The scanner's own
   * page lets a reader move every cutoff; this line is a cross-reference to it,
   * and a cross-reference that moved with someone else's slider would be
   * telling this page's reader something they cannot check.
   */
  const scannerPassed = scannerView?.scan
    ? scoreAndJudge(scannerView.scan.rows, DEFAULT_FILTERS).filter(
        (entry) => entry.passes && !entry.earningsExcluded,
      ).length
    : null;

  const staleness = snapshotStaleness(movers.capturedAt);

  return (
    <>
      <StaleDataBanner staleness={staleness} />

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title={movers.live ? 'Moving today' : 'Moved last session'}
          description={PAGE_DESCRIPTIONS['/movers']}
          /*
            Which source produced this, and which session it describes. The
            source is named because the two readings are not interchangeable
            and only one of them can ever appear in production — see
            `MoversSource`. The session date is shown either way: a reader has
            to be able to see which day they are looking at.
          */
          meta={
            movers.live
              ? `Live · Tradier · ${sessionLabel(movers.sessionDate)} · refreshed ${movers.capturedEt} ET`
              : `Last completed session · Polygon · ${sessionLabel(movers.sessionDate)} close`
          }
          asOfLabel={formatAsOf(new Date(movers.capturedAt))}
        />

        {/*
          The required explanation line, verbatim from `movers/types.ts` so the
          wording cannot drift away from the wording that was reviewed.
        */}
        <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
          <p className="font-bold text-flip">
            {movers.live ? MOVERS_EXPLANATION_LIVE : MOVERS_EXPLANATION}
          </p>
          <p className="mt-2 text-term-dim">
            One gate is applied and only one: the name has to be trading above{' '}
            {MIN_RELATIVE_VOLUME} times its own average volume, because a large
            move on thin volume is noise. Everything else on the row is context
            you read yourself. Nothing on this page says to buy or sell
            anything, and none of these names has passed the{' '}
            <a href="/scanner" className="underline decoration-dotted hover:text-term-text">
              scanner
            </a>
            &rsquo;s rules — it does not know this list exists, and this list has
            never made it looser.
          </p>
        </div>

        {/*
          Both states, honestly, one above the other. Never merged: the
          scanner's answer is a sentence, the movers list is a table, and the
          scanner's answer comes first so it cannot read as a caption on the
          table.
        */}
        <div className="panel px-3.5 py-3 text-xs leading-relaxed">
          <h2 className="label-xs">Today&rsquo;s scanner</h2>
          {scannerPassed === null ? (
            <p className="mt-1.5 text-term-dim">
              Today&rsquo;s scan has not run, so there is no scanner result to
              report. That is not the same as it having returned nothing.
            </p>
          ) : scannerPassed === 0 ? (
            <p className="mt-1.5 text-term-dim">
              <span className="font-bold text-term-text">
                No candidates met today&rsquo;s criteria.
              </span>{' '}
              The list below is not a replacement for that. It is a different
              question with a much weaker filter, and an empty scanner is a
              real answer rather than a gap to be filled.
            </p>
          ) : (
            <p className="mt-1.5 text-term-dim">
              <span className="font-bold text-term-text">
                {scannerPassed} {scannerPassed === 1 ? 'name' : 'names'} passed
                all five rules today, at the scanner&rsquo;s default settings.
              </span>{' '}
              Those are on{' '}
              <a href="/scanner" className="underline decoration-dotted hover:text-term-text">
                the scanner
              </a>
              . They are a separate list and this one neither adds to nor
              filters it.
            </p>
          )}
        </div>

        {movers.rows.length > 0 ? (
          <MoversBoard rows={movers.rows} />
        ) : (
          <div className="panel px-4 py-10 text-center text-xs">
            <p className="font-bold text-term-text">
              {movers.live
                ? 'Nothing is moving on volume.'
                : 'Nothing moved on volume.'}
            </p>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
              {movers.gainers} of {movers.measured} names read were up on{' '}
              {sessionLabel(movers.sessionDate)}, and none of them cleared{' '}
              {MIN_RELATIVE_VOLUME} times its own average volume
              {movers.live && movers.sessionProgress < 0.5
                ? ' — which is common this early, because the volume figure is a running total measured against a whole day.'
                : '.'}
            </p>
          </div>
        )}

        {/*
          The relative-volume caveat, and it sits under the table rather than
          in a tooltip because it changes how every number in that column
          reads.
        */}
        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">How this is built</h2>

          <p className="mt-1.5">
            <span className="text-term-dim">
              The universe is the same S&amp;P 500 list everything else here
              uses, and it is not widened.{' '}
            </span>
            Relative volume is a ratio against a name&rsquo;s own twenty-session
            average, and that average only exists for names whose history this
            project already stores. A wider list would put rows on this page
            whose one gate had never actually been applied.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              {movers.live
                ? 'Relative volume is a running total against a whole day. '
                : 'Both sides of the volume ratio are complete days. '}
            </span>
            {movers.live ? (
              <>
                The numerator is the shares traded so far today; the
                denominator is the average of twenty complete sessions. It is
                deliberately not scaled by how much of the session has elapsed
                — volume does not arrive evenly, and prorating it linearly
                would roughly treble every reading in the first half hour, on
                the part of the day when a movers list most invites chasing. So
                the figure understates early and is exact after the close. This
                session was {Math.round(movers.sessionProgress * 100)}% elapsed
                when these were read.
              </>
            ) : (
              <>
                The numerator is every share traded in the session named above;
                the denominator is the average of the twenty complete sessions
                before it. Neither is a partial figure, so the number needs no
                allowance made for the time of day it was read — which is the
                whole reason this page reports a session that has closed rather
                than one still running.
              </>
            )}
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The four context columns are never combined.{' '}
            </span>
            Where the price sits against its 200-day average, its
            relative-strength rank, its sector and whether that sector is
            leading, and the volume multiple — four separate readings, shown
            plainly. There is no composite score, because a single number would
            put &ldquo;up six percent and already strong&rdquo; and &ldquo;up
            six percent off a broken chart&rdquo; on the same row of the same
            colour.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Warnings flag, they never exclude.{' '}
            </span>
            Earnings within {EARNINGS_WARN_DAYS} days, below the 200-day average, extended far
            above the 20-day, and unusually high relative volume are each shown
            on the row and none of them removes a name. Where no earnings date
            can be established the row says the date is unknown; an unknown
            date is never read as &ldquo;no earnings soon&rdquo;.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Built on read, with no scheduled job and nothing stored.{' '}
            </span>
            {movers.live ? (
              <>
                This reading is the live intraday one, priced from a quote feed
                that is available on a development machine and never in
                production. The published site always shows the last completed
                session instead, from a different provider — so what is on this
                screen is not what a visitor would see.
              </>
            ) : (
              <>
                One request for the session&rsquo;s share volumes, over price
                history this project already keeps. The session shown is the
                one that history is current to, so this page cannot get ahead
                of it, and the reading is held for{' '}
                {Math.round(REFRESH_SECONDS / 60)} minutes because a closed
                session has no way to change until the overnight refresh lands
                the next one.
              </>
            )}
          </p>

          <p className="mt-2">
            <span className="text-term-dim">Gainers only, in this version. </span>
            There is no losers list. A falling name needs a different set of
            warnings beside it to be read honestly, and shipping half of that
            would be worse than shipping none.
          </p>
        </section>

        {movers.notes.map((note) => (
          <p
            key={note}
            className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-flip/80"
          >
            ! {note}
          </p>
        ))}
      </main>

      <Footer />
    </>
  );
}
