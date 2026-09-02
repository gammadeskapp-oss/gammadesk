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
    'The S&P 500 scored against five rules every morning and ranked, with every rule state shown on every name — passed, failed or not measured.',
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
            This page reports which names passed the rules and which did not,
            ranked. It does not say what to do about any of them, and there is
            no position sizing, target or stop anywhere on it. A name at the
            top of the list is the name nothing scored higher than — that is
            all a rank is.
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
            contractTopN={view.contractTopN}
          />
        ) : (
          /*
            No scan today. Deliberately not filled in with the last stored one:
            a Tuesday list under a Wednesday heading is exactly the failure this
            page is arranged to prevent. A page view cannot trigger the scan
            either — it spends a batch of option chains, and it is only
            meaningful at the time it was scheduled for.
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
                  The last stored scan was {latest.date}, when {latest.scored}{' '}
                  names were scored.
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
            <span className="text-term-dim">
              It ranks. It used to gate, and the gating is what broke it.{' '}
            </span>
            Five rules were ANDed together and the page printed whatever
            survived all five. Two runs in a row that was zero names out of
            five hundred, and an empty page cannot tell you anything &mdash;
            not which rule ate the list, not how close anything came, not
            whether the market was the problem or the numbers were. So the five
            are scored and blended into one 0&ndash;100 composite, the whole
            index is ordered by it, and the top {view.contractTopN} are always
            on the page. Names clearing every rule come first; the rest fill
            the table below them, dimmed, with the rules they failed in red and
            the reading that failed them printed beside it.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Every cutoff is yours, and none of them costs a request.{' '}
            </span>
            The relative-strength cutoff, the volume multiple, the turnover
            floor, the distance above the {view.trendEmaPeriod}-day average,
            the expiry and delta window, the earnings buffer, and an on/off
            switch for each of the five rules. They open on the shipped
            defaults &mdash; RS {view.rsMin}, volume confirmed, above the
            200-day &mdash; so every change you make is visibly a change from
            something. All of it is applied in the browser to the snapshot the
            morning job stored, so moving a slider makes no network request at
            all. That is not a nicety: the scan spends the chain
            provider&rsquo;s daily budget, and a control that could re-run it
            would put that budget at the mercy of a drag gesture. Your settings
            live in the address bar, so a configuration can be bookmarked or
            sent to someone.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The funnel is the answer to &ldquo;why is this empty&rdquo;.{' '}
            </span>
            One row of cumulative counts above the table: how many were
            scanned, then how many cleared each rule in turn, then how many are
            clear of earnings. Each count is the names that cleared that step{' '}
            <em>and every step before it</em>, so the numbers only ever go down
            and the arithmetic checks by eye. Click one to see exactly which
            names reached it. This is the piece that was missing, and its
            absence is why a zero-result morning was unreadable.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The market regime is a banner, not a rule.{' '}
            </span>
            It was the fifth gate, evaluated per name &mdash; which was a
            category error with a real cost. It is one market-wide condition,
            identical for every stock in the index, so on a volatile morning
            all five hundred names failed at the same step and the page went
            blank for a reason that had nothing to do with any of them. It is
            stated once, at the top, in plain English. There is one optional
            toggle to hide the list when the market is not calm, and it is off
            by default.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The contract is the fifth rule, and it is the honest one.{' '}
            </span>
            A name can clear everything above and still have a chain nobody
            should touch. Each graded name is scored on the best call inside
            your expiry and delta window: Excellent, Tradable, Caution or
            Avoid, with the days to expiry, delta, open interest and bid/ask
            spread shown beside it. Cboe answers a limited number of chains per
            window and the {schedule.gammaEt} gamma job has first call on them,
            so contracts are pulled for the top {view.contractTopN} by score
            and nothing else &mdash; which is exactly how many rows the table
            shows, so every name on screen has had all five of its rules
            actually tested. Anything below that reads{' '}
            <span className="text-term-dim">contract not checked</span> in
            grey. That is unknown, not failed: nobody looked, and a name is
            never pushed down the list for a reading nobody took.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Unknown is never folded into failed.{' '}
            </span>
            A rule that could not be evaluated &mdash; a chain that did not
            answer, a name without {view.trendEmaPeriod} daily bars, an option
            whose spread was not quoted &mdash; is shown grey with the reason
            given, and its component is dropped from the score rather than
            counted as zero. Scoring an unknown as zero would rank a name below
            one graded Avoid, which would be a statement about this
            site&rsquo;s data pipeline dressed up as a statement about the
            stock. Missing data masquerading as a bearish reading is the single
            most misleading thing this page could do.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Earnings inside your buffer remove a name.{' '}
            </span>
            Holding an option through a report is a different trade from the
            one every rule above tests for. Dates come from Tradier&rsquo;s
            fundamentals calendar &mdash; the event calendar this site keeps is
            macro only and carries no company dates. Where no date can be
            established the name is kept and its watch line says the date is
            unknown; an unknown date is never read as &ldquo;no earnings
            soon&rdquo;. The default buffer is 10 days, and the run rate above
            is always recorded at that default so ninety days of history stay
            comparable with each other.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Scoring the whole index costs nothing upstream.{' '}
            </span>
            Every reading a rule needs &mdash; the {view.trendEmaPeriod}-day
            and 20-day averages, the volume ratio, the turnover &mdash; is
            already in the relative-strength digest this site stores and reads
            on every page view. The old scan pulled three bar series per
            candidate, which is why it could only ever look at the two dozen
            names that had already cleared the floor, and why the floor could
            never be one of these controls.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              A ranking is an ordering, and nothing more.{' '}
            </span>
            A name at the top of the table is the name nothing scored higher
            than. It is not a suggestion, the page does not say what to do
            about it, and there is no position size, target or stop anywhere on
            it. Every row keeps a watch line naming what would undo it, and
            failing rows are dimmed rather than removed &mdash; a list you
            cannot see the failures in is a list you have to take on trust.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Nadaraya-Watson is a line on the chart and nothing else.{' '}
            </span>
            The non-repainting endpoint estimator hugs recent price, while the
            band width is the average absolute deviation across the whole{' '}
            {view.nw.lookback}-bar window, so the quantity being tested is
            structurally much smaller than the one setting the threshold and
            price clears the band only rarely. It gated nothing and now ranks
            nothing. Current settings: bandwidth {view.nw.bandwidth}, lookback{' '}
            {view.nw.lookback}, multiplier {view.nw.mult}. The band is computed
            on 1H and daily only &mdash; the bar source serves about half the
            window at the 4-hour interval, and edges measured over the wrong
            window are worse than no edges.
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
