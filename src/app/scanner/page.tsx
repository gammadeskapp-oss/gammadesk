import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { ScannerBoard } from '@/components/ScannerBoard';
import { ScannerRunRate } from '@/components/ScannerRunRate';
import { InfoTip } from '@/components/InfoTip';
import { getBreadth } from '@/lib/breadth';
import { breadthSentence } from '@/lib/breadth/wording';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { getScannerView, storeStatus } from '@/lib/scanner';
import { formatEtClock } from '@/lib/scanner/schedule';
import { formatAsOf } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Scanner',
  description:
    "Five hard rules applied to the S&P 500 each morning, with the option contract checked on every name that passes.",
};

export const dynamic = 'force-dynamic';

export default async function ScannerPage() {
  const view = await getScannerView();
  // Reads a stored document, so it costs the scan nothing.
  const breadth = await getBreadth().catch(() => null);
  const store = storeStatus();
  const { scan, latest, gamma, schedule } = view;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title="Scanner"
          description={PAGE_DESCRIPTIONS['/scanner']}
          meta={
            scan
              ? `Run ${formatAsOf(new Date(scan.scannedAt))}`
              : latest
                ? `Last run ${latest.date}`
                : 'Not yet run'
          }
        />

        {/*
          One read-only line of market-wide context.

          It is here because it explains the shape of the list — a morning
          where almost nothing is participating produces few candidates, and
          knowing that is different from concluding the scan is broken. It is
          deliberately NOT a rule: nothing downstream reads it, no row is
          included or excluded by it, and the five rules are still five.
        */}
        {breadth?.computed && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-2xs text-term-faint">
            <span className="label-xs">Breadth</span>
            <InfoTip for="breadth" />
            <span className="font-bold tabular-nums text-term-text">
              {Math.round(breadth.computed.pctAbovePriorClose)}%
            </span>
            <span>{breadthSentence(breadth.computed)}</span>
            <span className="text-term-dim">
              Context only — it is not one of the rules.
            </span>
          </p>
        )}

        {/*
          Above the list, because it changes how every row on it reads. The
          scan is deliberately early and the earliness is the main caveat.
        */}
        <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-term-text">
            <span className="font-bold text-flip">
              This runs at {schedule.scanEt} ET, minutes into the session.{' '}
            </span>
            Everything here is measured on daily bars and on a chain quoted
            before the open, so the list does not swing on the first few
            minutes of trading — but the prices beside it are that early, and
            the day has barely started.
          </p>
          <p className="mt-2 text-term-dim">
            This page reports which names passed a fixed rule set. It does not
            say what to do about any of them, and there is no position sizing,
            target or stop anywhere on it.
          </p>
        </div>

        {/*
          Above the list, because a shortlist of three cannot be read without
          it: three out of a typical twenty is a thin day, three out of a
          typical four is an ordinary one, and the list itself cannot say which.
        */}
        <ScannerRunRate counts={view.counts} average={view.averagePassed} />

        {scan ? (
          <ScannerBoard
            scan={scan}
            nwSettings={{
              bandwidth: view.nw.bandwidth,
              lookback: view.nw.lookback,
              mult: view.nw.mult,
            }}
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
            {/*
              A link, and deliberately not a list. /movers answers a different
              and much weaker question, and embedding its rows under this
              heading on the mornings this page is empty is exactly how a
              movers list becomes mistaken for scanner output. The reader has
              to leave this page to see them.
            */}
            <p className="mx-auto mt-3 max-w-2xl leading-relaxed text-term-dim">
              This is a real answer, not a gap. If what you want is simply what
              moved in the last completed session, that is a separate page with
              a much weaker filter:{' '}
              <a
                href="/movers"
                className="underline decoration-dotted hover:text-term-text"
              >
                Moved Last Session
              </a>
              . Nothing on it has passed these rules.
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
            <span className="text-term-dim">Five rules, all of which must pass. </span>
            Relative strength above {view.rsMin}; price above the{' '}
            {view.trendEmaPeriod}-day average; the move volume-confirmed;
            equity liquidity HIGH and options liquidity MEDIUM or better; and
            SPY in a calm regime. Every rule&rsquo;s state is shown for every
            ticker — passed, failed, or unknown — rather than only the final
            verdict.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Then two things that are not rules.{' '}
            </span>
            A name reporting earnings within 10 calendar days is removed
            outright. A name trading far above its 20-day average is flagged as
            extended and kept — being extended is what a strong name does, and
            rejecting on it would throw away the strongest names in the list
            for being strong.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Relative strength runs first, and gates everything after it.{' '}
            </span>
            Only names above RS {view.rsMin} have their option chains refreshed
            at {schedule.gammaEt} ET, and only they have bars pulled at{' '}
            {schedule.scanEt}. That also bounds the &ldquo;every candidate
            scanned&rdquo; list below: it covers names that cleared RS{' '}
            {view.rsMin}, not names that narrowly missed the floor itself.
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
            data gets all day. If the {schedule.gammaEt} job did not run, the
            liquidity and market-regime gates read unknown and nothing passes.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The market regime is a single market-wide gate, and it is hard.{' '}
            </span>
            When SPY&rsquo;s regime is not calm the scan returns nothing, with
            that stated, rather than a list of individually strong charts in a
            regime where dealers amplify moves. There is deliberately no
            setting that turns this into a score penalty: such a control exists
            only to produce results on the days that should not have any.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Three rules were removed, and one was narrowed.{' '}
            </span>
            VWAP left the scan entirely — anchored on a session minutes old it
            was a coin toss, and on a daily series it was very nearly that
            bar&rsquo;s own typical price. Nadaraya-Watson is a line on the
            chart now and gates nothing. A name&rsquo;s own gamma regime is
            context text on its card rather than a gate, because the
            single-stock dealer-sign assumption is the weakest thing here and
            was quietly deleting names on the strength of it. And the trend
            gate is the daily {view.trendEmaPeriod}-day average only: &ldquo;above
            the 200-day average&rdquo; is a claim a reader can go and check.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Earnings inside 10 calendar days remove a name outright.{' '}
            </span>
            Holding an option through a report is a different trade from the
            one every rule above tests for. Dates come from Tradier&rsquo;s
            fundamentals calendar — the event calendar this site keeps is macro
            only and carries no company dates. Where no date can be
            established the name is kept and its watch line says the date is
            unknown; an unknown date is never read as &ldquo;no earnings
            soon&rdquo;.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The contract is checked, not just the stock.{' '}
            </span>
            A name can clear every rule above and still have a chain nobody
            should touch. Each passing name is graded on the best call between
            30 and 60 days out at a delta of 0.55 to 0.70: Excellent, Tradable,
            Caution or Avoid, with the days to expiry, delta, open interest and
            bid/ask spread shown beside it. Where the spread or the open
            interest is missing the badge reads Unknown — never green over
            incomplete data. The top ten ranked names are graded at{' '}
            {schedule.scanEt}; the rest are graded when you open them, because
            the chain provider answers a limited number of requests a day.
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
              Why it neither filters nor ranks.{' '}
            </span>
            The endpoint estimator fits each bar from the bars up to it, so it
            hugs recent price closely. The band width, though, is the average
            absolute deviation across the whole {view.nw.lookback}-bar window.
            The quantity being tested is therefore structurally much smaller
            than the quantity setting the threshold, and price clears the band
            only rarely — requiring it returned nothing on almost every day. It
            briefly decided the order of the list instead, which gave a reading
            about one name against its own regression more authority over the
            reader&rsquo;s attention than it earns. It is a line on the chart
            now. The list is ordered by relative strength, which is the number
            the list is built around and one you can check on{' '}
            <a href="/strength" className="text-term-dim underline decoration-dotted">
              Stock Strength
            </a>
            .
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
            still carries the {view.trendEmaPeriod} EMA, which needs far fewer
            bars and is unaffected. A source with two years of 4-hour history
            would bring it back.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">Unknown is never folded into failed. </span>
            A gate that could not be computed — a chain that did not answer, a
            daily series without {view.trendEmaPeriod} bars, an option whose
            spread was not quoted — excludes the ticker exactly as a failure
            does, but is shown grey and the reason is given. Missing data masquerading as a bearish reading is the
            single most misleading thing this page could do.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              There is no strictness toggle, and no near-miss list.{' '}
            </span>
            Both are gone. An adjustable agreement setting could report the
            same name as passing or failing depending on a control the reader
            had probably not noticed, and a near-miss list is a list of names
            that did not pass presented next to names that did. Five hard
            rules, one list. Every rule state for every candidate is still
            computed once at {schedule.scanEt} ET and stored, and every
            candidate is shown with its five states under &ldquo;every
            candidate scanned&rdquo;.
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
