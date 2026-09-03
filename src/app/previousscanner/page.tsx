import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { PreviousScannerBoard } from '@/components/PreviousScannerBoard';
import { getScannerView, storeStatus } from '@/lib/previousscanner';
import { formatEtClock } from '@/lib/previousscanner/schedule';
import { formatAsOf } from '@/lib/time';

/**
 * Unlisted, and deliberately not private.
 *
 * `noindex, nofollow` overrides the site-wide `index, follow` from the root
 * layout, and there is no link to this route anywhere in the navigation. That
 * keeps it out of search results and out of the way — it does not keep anyone
 * out. Anybody who types the URL can read it. If it needs to be genuinely
 * restricted, the way to do that is a passcode from an environment variable,
 * checked here before anything renders.
 */
export const metadata: Metadata = {
  title: 'Legacy Scanner',
  description:
    'The previous scanner build, kept for reference. Not maintained.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const LEGACY_DESCRIPTION =
  'The earlier seven-filter build, across three timeframes, ranked by Nadaraya-Watson extension.';

export default async function PreviousScannerPage() {
  const view = await getScannerView();
  const store = storeStatus();
  const { scan, latest, gamma, schedule } = view;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {/*
          First thing on the page, above even the heading's own caveats.
          Everything below this line is a snapshot of an older rule set,
          restored unchanged — including the parts that did not work.
        */}
        <div className="panel border-l-2 border-l-flip px-3.5 py-2.5 text-xs leading-relaxed">
          <p className="font-bold text-flip">
            Legacy scanner. Kept for reference, not maintained.
          </p>
          <p className="mt-1 text-term-dim">
            This is the earlier build, restored as it was and not corrected.
            Its known problems are still here: the Nadaraya-Watson band is very
            nearly unsatisfiable at the shipped multiplier of{' '}
            {view.nw.mult}, and the bar source serves roughly 252 four-hour
            bars against the {view.nw.lookback} the window asks for. The
            current scanner is at{' '}
            <a href="/scanner" className="underline decoration-dotted hover:text-term-text">
              /scanner
            </a>
            .
          </p>
          <p className="mt-1 text-term-faint">
            It has no scheduled job. The list below was computed the first time
            this page was opened today and then stored, so &ldquo;scheduled for{' '}
            {schedule.scanEt} ET&rdquo; on the panels underneath is inherited
            wording — read the time it actually ran instead. That matters more
            here than it would elsewhere, because this build gates on VWAP, and
            VWAP in the afternoon is not the reading the rule was written for.
            Dealer gamma is read from the document the live {schedule.gammaEt}{' '}
            job already stores, so opening this page spends no option chains.
          </p>
        </div>

        <PageBar
          title="Legacy Scanner"
          description={LEGACY_DESCRIPTION}
          meta={
            scan
              ? `${scan.date} session`
              : latest
                ? `Last run ${latest.date}`
                : 'Not yet run'
          }
          asOfLabel={scan ? formatAsOf(new Date(scan.scannedAt)) : undefined}
        />

        {/*
          Above the list, because it changes how every row on it reads. The
          scan is deliberately early and the earliness is the main caveat.
        */}
        <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-term-text">
            <span className="font-bold text-flip">
              At {schedule.scanEt} ET the session VWAP is five minutes old.{' '}
            </span>
            Those five minutes are the noisiest trading of the day. A name can
            sit above VWAP at {schedule.scanEt} and below it five minutes later.
            The list is real, and this early it is jumpy.
          </p>
          <p className="mt-2 text-term-dim">
            This page reports which names passed a fixed rule set. It does not
            say what to do about any of them, and there is no position sizing,
            target or stop anywhere on it.
          </p>
        </div>

        {scan ? (
          <PreviousScannerBoard
            scan={scan}
            nwSettings={{
              bandwidth: view.nw.bandwidth,
              lookback: view.nw.lookback,
              mult: view.nw.mult,
            }}
            vwapAnchor={view.vwapAnchor}
            trendEmaPeriod={view.trendEmaPeriod}
            gammaTimeEt={schedule.gammaEt}
            scannedAtEt={formatEtClock(new Date(scan.scannedAt))}
          />
        ) : (
          /*
            No scan today. Deliberately not filled in with the last stored one:
            a Tuesday list under a Wednesday heading is exactly the failure this
            page is arranged to prevent. A page view cannot trigger the scan
            either — it spends about fifty option chains and a few hundred bar
            series, and it is
            only meaningful at the time it was scheduled for.
          */
          <div className="panel px-4 py-10 text-center text-xs">
            <p className="font-bold text-term-text">
              Today&rsquo;s scan has not run.
            </p>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
              The scan is scheduled for {schedule.scanEt} ET and its result is
              stored once and read all day. Nothing is shown here in the
              meantime — an older day&rsquo;s list under today&rsquo;s heading
              would be worse than an empty page.
              {latest && (
                <>
                  {' '}
                  The last stored scan was {latest.date}, when {latest.candidates}{' '}
                  names cleared RS {latest.rsMin}.
                </>
              )}
            </p>
            <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-faint">
              {gamma?.date
                ? `Candidate gamma was last refreshed for ${gamma.date} (${Object.keys(gamma.symbols).length} chains).`
                : 'No candidate gamma refresh has been stored yet.'}
            </p>
          </div>
        )}

        {scan?.notes.map((note) => (
          <p key={note} className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-flip/80">
            ! {note}
          </p>
        ))}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">How this is built</h2>

          <p className="mt-1.5">
            <span className="text-term-dim">Seven gates, all of which must pass. </span>
            Relative strength above {view.rsMin}; the move volume-confirmed;
            equity liquidity HIGH and options liquidity MEDIUM or better; the
            ticker&rsquo;s own dealer gamma regime positive; SPY&rsquo;s gamma
            regime positive; and price above VWAP and above the{' '}
            {view.trendEmaPeriod} EMA. Every gate&rsquo;s state is shown for
            every ticker — passed, failed, or unknown — rather than only the
            final verdict.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Nadaraya-Watson is the eighth reading and is not a gate.{' '}
            </span>
            Nothing fails the scan on it. It orders the names that got through
            instead, by how far price has extended above its own band — see
            below for why it cannot sensibly be a filter.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Relative strength runs first, and gates everything after it.{' '}
            </span>
            Only names above RS {view.rsMin} have their option chains refreshed
            at {schedule.gammaEt} ET, and only they have bars pulled at{' '}
            {schedule.scanEt}. That also bounds the near-miss list below: it
            covers candidates that cleared RS {view.rsMin} and then missed one
            other filter, not names that narrowly missed the RS floor itself.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The gamma on this page is same-day, never from the nightly cache.{' '}
            </span>
            The nightly rotation covers a quarter of the tracked universe a
            night, because Cboe answers roughly sixty chain requests per window
            and then refuses — a quota, not a rate, so a longer job does not
            help. That leaves any ticker&rsquo;s cached gamma up to four days
            old, which is too stale to scan on. Refreshing only the RS-clearing
            names is about fifty chains, which fits one window with little to
            spare; {schedule.gammaEt}{' '}
            is also after open interest publishes, so it is the freshest the
            data gets all day. If the {schedule.gammaEt} job did not run, filters
            4 and 5 read unknown and nothing passes.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              SPY&rsquo;s gamma regime is a single market-wide gate.{' '}
            </span>
            When it is negative the scan returns nothing, with that stated,
            rather than a list of individually strong charts in a regime where
            dealers amplify moves.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              VWAP is anchored per timeframe: {view.vwapAnchor['1h']} on 1H,{' '}
              {view.vwapAnchor['4h']} on 4H, {view.vwapAnchor['1D']} on daily.{' '}
            </span>
            A session anchor on a daily series is meaningless — every daily bar
            is its own session, so the VWAP would be that bar&rsquo;s own typical
            price and the comparison would be a coin toss. The anchors are
            configurable.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Nadaraya-Watson uses the non-repainting endpoint form.{' '}
            </span>
            The widely-copied TradingView version refits across the whole
            visible series, so historical values change as new bars arrive; a
            scanner built on it would disagree with your own chart by the time
            you opened it. This one fits each bar from that bar and the bars
            before it only. Current settings: bandwidth {view.nw.bandwidth},
            lookback {view.nw.lookback}, multiplier {view.nw.mult} — all
            configurable, so they can be set to whatever your chart is using.
            Green means price is above the band, red below it, amber inside it.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Why it ranks instead of filtering.{' '}
            </span>
            The endpoint estimator fits each bar from the bars up to it, so it
            hugs recent price closely. The band width, though, is the average
            absolute deviation across the whole {view.nw.lookback}-bar window.
            The quantity being tested is therefore structurally much smaller
            than the quantity setting the threshold, and price clears the band
            only rarely — requiring it on several timeframes at once returned
            nothing on almost every day. So the reading is kept and the cut is
            dropped. The column shows{' '}
            <span className="text-term-dim">z = (close &minus; centre) &divide; half-band</span>
            : 1 is the upper edge, 0 the centre line, &minus;1 the lower edge.
            Qualifying names are sorted by their daily z, highest first.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The band is computed on 1H and daily only.{' '}
            </span>
            Its width is a flat average over {view.nw.lookback} bars, and the
            bar source serves only about half that many at the 4-hour interval.
            The centre line would be unaffected — the kernel weights are
            negligible past a few dozen bars — but the edges would be measured
            over the wrong window, and the edges are the entire reading. 4H
            shows a dash rather than a number computed from half the sample. It
            still carries VWAP and the {view.trendEmaPeriod} EMA, which need far
            fewer bars and are unaffected. A source with two years of 4-hour
            history would bring it back.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">Unknown is never folded into failed. </span>
            A gate that could not be computed — a chain that did not answer, a
            4-hour series without {view.trendEmaPeriod} bars — excludes the
            ticker exactly as a failure does, but is shown grey and the reason
            is given. Missing data masquerading as a bearish reading is the
            single most misleading thing this page could do.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The strictness toggle never re-scans anything.{' '}
            </span>
            Every filter state for every candidate is computed once at{' '}
            {schedule.scanEt} ET and stored. Switching between all-three, any-2
            and daily-only only changes how those stored states are counted,
            which is why the pass list and the near-miss list can never
            disagree.
          </p>

          {gamma && scan && gamma.date !== scan.date && (
            <p className="mt-2 text-flip/80">
              ! The stored gamma is dated {gamma.date} and this scan is dated{' '}
              {scan.date}. The scan treats gamma from another session as absent
              rather than using it.
            </p>
          )}

          {!store.durable && store.note && (
            <p className="mt-2 text-flip/80">! {store.note}</p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
