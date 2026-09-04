import type { Metadata } from 'next';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Footer } from '@/components/Footer';
import { MoversBoard } from '@/components/MoversBoard';
import { PageBar } from '@/components/PageBar';
import { DELAYED_FEED_REFRESH_MS } from '@/hooks/useAutoRefresh';
import { StaleDataBanner } from '@/components/StaleDataBanner';
import { currentMarketStatus, snapshotStaleness } from '@/lib/events';
import { EARNINGS_WARN_DAYS } from '@/lib/movers/rules';
import {
  MIN_RELATIVE_VOLUME,
  MOVERS_EXPLANATION,
  MOVERS_EXPLANATION_LIVE,
  MOVERS_EXPLANATION_LIVE_CLOSED,
  MOVERS_EXPLANATION_LIVE_PREOPEN,
  REFRESH_SECONDS,
  getMovers,
} from '@/lib/movers';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { getScannerView } from '@/lib/scanner';
import { DEFAULT_FILTERS, scoreAndJudge } from '@/lib/scanner/score';
import { sessionLabel } from '@/lib/staleness';
import { formatAsOf } from '@/lib/time';

/**
 * Unlisted, and deliberately not private — the same arrangement as
 * `/previousscanner`.
 *
 * `noindex, nofollow` overrides the site-wide `index, follow` from the root
 * layout, and the sidebar no longer lists this route. It is still reached from
 * `/scanner`, which is where a reader who wants it should meet it: after the
 * rules, never instead of them.
 */
export const metadata: Metadata = {
  title: 'Moved last session',
  description:
    'S&P 500 names that closed up on more than 1.5 times their own average volume in the last completed session, with the context to check each one against. Not a scanner result.',
  robots: { index: false, follow: false },
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
    ? scoreAndJudge(scannerView.scan.rows, DEFAULT_FILTERS, {
        spyRegime: scannerView.scan.spyRegime,
      }).filter(
        (entry) => entry.passes && !entry.earningsExcluded,
      ).length
    : null;

  const staleness = snapshotStaleness(movers.capturedAt);

  /*
   * ## Why the live branch needs three labels, not one
   *
   * `movers.live` says which feed priced these rows. It says nothing about
   * where the clock is, and every word of the live wording assumed a session
   * was running -- "moving today", "shares traded so far today", "this session
   * was 4% elapsed". At 01:53 that described a day which had not opened.
   *
   * Nothing below reads or changes the reading itself. It splits the label the
   * page already had on `live` by the market phase, which the page can ask for
   * on its own.
   *
   *   in-session   the original live wording, unchanged and still correct
   *   finished     the session closed; the figures are whole-day on both sides
   *   not-started  pre-open, a weekend or a holiday: no session behind them
   *
   * `not-started` deliberately does not borrow the Polygon path's "moved last
   * session" wording. That line promises a completed session with a whole day
   * on each side of the volume ratio; before the open the numerator is an
   * empty day in progress, and `sessionDate` is the day that has not started
   * rather than the one that closed. Relabelling it would replace a visibly
   * wrong claim with a plausible one, which is the worse of the two.
   */
  const market = currentMarketStatus();
  const livePhase = !movers.live
    ? null
    : market.open
      ? 'in-session'
      : market.phase === 'after-close'
        ? 'finished'
        : 'not-started';

  return (
    <>
      <StaleDataBanner staleness={staleness} />

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title={
            livePhase === null
              ? 'Moved last session'
              : livePhase === 'in-session'
                ? 'Moving today'
                : livePhase === 'finished'
                  ? 'Moved today'
                  : 'No session yet'
          }
          description={PAGE_DESCRIPTIONS['/movers']}
          /*
            Which source produced this, and which session it describes. The
            source is named because the two readings are not interchangeable
            and only one of them can ever appear in production — see
            `MoversSource`. The session date is shown either way: a reader has
            to be able to see which day they are looking at.
          */
          meta={
            livePhase === null
              ? `Last completed session · Polygon · ${sessionLabel(movers.sessionDate)} close`
              : `${
                  livePhase === 'in-session'
                    ? 'Live'
                    : livePhase === 'finished'
                      ? 'Live feed, session closed'
                      : 'Live feed, no session open'
                } · Tradier · ${sessionLabel(movers.sessionDate)} · read ${movers.capturedEt} ET`
          }
          asOfLabel={formatAsOf(new Date(movers.capturedAt))}
        />

        <div className="flex justify-end">
          <AutoRefresh intervalMs={DELAYED_FEED_REFRESH_MS} />
        </div>

        {/*
          The required explanation line, verbatim from `movers/types.ts` so the
          wording cannot drift away from the wording that was reviewed.
        */}
        <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
          <p className="font-bold text-flip">
            {livePhase === null
              ? MOVERS_EXPLANATION
              : livePhase === 'in-session'
                ? MOVERS_EXPLANATION_LIVE
                : livePhase === 'finished'
                  ? MOVERS_EXPLANATION_LIVE_CLOSED
                  : MOVERS_EXPLANATION_LIVE_PREOPEN}
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
                every filter today, at the scanner&rsquo;s default settings.
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
              {livePhase === 'in-session'
                ? 'Nothing is moving on volume.'
                : livePhase === 'not-started'
                  ? 'The session has not started.'
                  : 'Nothing moved on volume.'}
            </p>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
              {livePhase === 'not-started' ? (
                <>
                  There is no session volume to measure against yet, so the one
                  gate this page applies cannot be applied and no name can pass
                  it. {market.nextUpdateLine} The published site never uses this
                  feed — it shows the last completed session instead.
                </>
              ) : (
                <>
                  {movers.gainers} of {movers.measured} names read were up on{' '}
                  {sessionLabel(movers.sessionDate)}, and none of them cleared{' '}
                  {MIN_RELATIVE_VOLUME} times its own average volume
                  {livePhase === 'in-session' && movers.sessionProgress < 0.5
                    ? ' — which is common this early, because the volume figure is a running total measured against a whole day.'
                    : '.'}
                </>
              )}
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
              {livePhase === 'in-session'
                ? 'Relative volume is a running total against a whole day. '
                : livePhase === 'not-started'
                  ? 'There is no volume in the numerator yet. '
                  : 'Both sides of the volume ratio are complete days. '}
            </span>
            {livePhase === 'not-started' ? (
              <>
                The numerator is the shares traded so far in the session named
                above, and that session has not opened. Every reading is
                therefore zero or close to it, which is why the list is empty
                rather than short. Nothing is scaled up to compensate — a
                figure invented from an empty day would be the one number on
                this page that came from nowhere.
              </>
            ) : livePhase === 'in-session' ? (
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
            ) : livePhase === 'finished' ? (
              <>
                The numerator is every share traded in the session named above,
                which has now closed; the denominator is the average of twenty
                complete sessions. Both sides are whole days, so this reading
                needs no allowance made for the time of day it was taken —
                the caveat that applies to this feed during a session does not
                apply once that session has ended.
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
