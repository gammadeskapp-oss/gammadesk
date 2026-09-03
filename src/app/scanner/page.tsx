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
import { DEFAULT_FILTERS } from '@/lib/scanner/score';
import { SCANNER_TOP_N } from '@/lib/scanner/types';
import { formatEtClock } from '@/lib/scanner/schedule';
import { formatAsOf } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Scanner',
  description:
    'The S&P 500 scored 0-100 every morning and ranked, with every component of the score shown on every name — measured, or honestly marked as not measured.',
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
          deliberately NOT part of the score: nothing downstream reads it, and
          no row is ranked or marked by it.
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
              Context only — it is not part of the score.
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
            This page ranks names and shows what each part of the ranking was
            built from. It does not say what to do about any of them, there is
            no position sizing, target or stop anywhere on it, and no row here
            is a suggestion to buy or sell. A name at the top of the list is the
            name nothing scored higher than &mdash; that is all a rank is.
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
              . Nothing on it has been scored or ranked here.
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
              One score, seven components, the whole index.{' '}
            </span>
            Every scoreable name in the S&amp;P 500 gets a 0&ndash;100
            composite: relative strength (counted double), trend, volume,
            distance above its daily VWAP, its own dealer gamma, the
            market&rsquo;s dealer gamma, and how well its options actually
            trade. The top {SCANNER_TOP_N} by that score are always on the page,
            and each of the seven is its own column, so the composite is a
            number you can check rather than one you have to trust.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The trend column is four readings averaged.{' '}
            </span>
            Above its 50-day average, above its 200-day average, the 50 above
            the 200, and where its last month&rsquo;s return ranks against the
            rest of the index. Averaged rather than ANDed, because the point of
            a column is to tell a name that has three of the four from a name
            that has none &mdash; and a reading that could not be taken is left
            out of the average rather than counted against the name. Sort by it,
            or by any other component, from the column heading.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Filters narrow the list. They cannot empty it.{' '}
            </span>
            This used to be five rules ANDed together with the survivors
            printed, and twice in a row that was zero names out of five hundred
            &mdash; an empty page that could not tell you which rule ate the
            list. Now the eight filters decide which rows are <em>marked</em> as
            matching, and the table shows the top {SCANNER_TOP_N} by score
            either way. They open on RS {DEFAULT_FILTERS.rsMin} and the turnover
            floor with everything else switched off, so what you see first is
            the ranking rather than one opinion about it. Your settings live in
            the address bar, so a configuration can be bookmarked or sent to
            someone, and every change is applied in the browser to the snapshot
            the morning job stored &mdash; moving a control makes no network
            request at all.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Every row says why it is there, next to what to be careful about.{' '}
            </span>
            The reasons are assembled from the components that actually scored
            highest, so the sentence and the columns cannot disagree, and when
            nothing scores strongly the line says exactly that rather than
            inventing a reason. The watch line beside it &mdash; earnings,
            extension, a contract graded Caution, negative dealer positioning
            &mdash; is rendered in the same size, on the same row, never behind
            a toggle.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The market regime is one component of seven.{' '}
            </span>
            It was a per-name gate once, which was a category error with a real
            cost: one market-wide condition, identical for all five hundred
            names, blanked the page on every volatile morning. Being identical
            for everyone, it moves the whole list and never the order of it. It
            is also stated once in plain English at the top.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The contract filters, and deliberately does not score.{' '}
            </span>
            Cboe answers a limited number of chains per window and the{' '}
            {schedule.gammaEt} gamma job has first call on them, so contracts
            are graded for the top {view.contractTopN} by score and nothing
            else. Making that grade part of the score would have meant the score
            deciding who got graded and the grade changing the score. It marks a
            row and cautions on it; it never moves a name up or down. Anything
            ungraded reads{' '}
            <span className="text-term-dim">contract not checked</span> in grey
            &mdash; unknown, not failed.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Unknown is never folded into failed.{' '}
            </span>
            A component that could not be measured &mdash; no chain pulled for
            that name, fewer than 200 daily bars, no volume history &mdash;
            shows a dash and is dropped from the blend rather than scored zero.
            Most of the index has no dealer-positioning reading at all, and
            scoring those absences as zero would rank the whole market below the
            few dozen names the morning job had budget for: a statement about
            this site&rsquo;s request budget dressed up as a statement about
            stocks.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The VWAP here is a daily one, not the intraday one.{' '}
            </span>
            It is the volume-weighted average price of the last twenty{' '}
            <em>daily</em> bars, not the session VWAP a trading platform draws
            from the opening bell. The session figure cannot be had for five
            hundred names without five hundred intraday requests every morning;
            this one costs nothing and comes from price history already stored.
            The column and its tooltip both say which it is.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Scoring the whole index costs nothing upstream.{' '}
            </span>
            Every reading &mdash; the averages, the VWAP, the volume ratio, the
            turnover, the one-month percentile &mdash; comes from the
            relative-strength history this site already stores. The old scan
            pulled three bar series per candidate, which is why it could only
            ever look at the two dozen names that had already cleared a floor,
            and why the floor could never be one of these controls.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              A ranking is an ordering, and nothing more.{' '}
            </span>
            A name at the top of the table is the name nothing scored higher
            than. It is not a suggestion, the page does not say what to do about
            it, and there is no position size, target or stop anywhere on it.
            What this ranking has actually produced afterwards is a separate
            question, answered with numbers rather than assurances on the{' '}
            <a
              href="/trackrecord"
              className="underline decoration-dotted hover:text-term-text"
            >
              scanner track record
            </a>{' '}
            page &mdash; every pick logged, winners and losers alike.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Nadaraya-Watson is a line on the chart and nothing else.{' '}
            </span>
            It gates nothing and scores nothing. Current settings: bandwidth{' '}
            {view.nw.bandwidth}, lookback {view.nw.lookback}, multiplier{' '}
            {view.nw.mult}. The band is computed on 1H and daily only &mdash;
            the bar source serves about half the window at the 4-hour interval,
            and edges measured over the wrong window are worse than no edges.
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
