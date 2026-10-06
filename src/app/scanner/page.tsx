import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { RefreshStatus } from '@/components/RefreshStatus';
import { ScannerBoard } from '@/components/ScannerBoard';
import { ScannerTabs } from '@/components/ScannerTabs';
import { ScannerMacroPanel, type MacroRow } from '@/components/redesign/ScannerMacroPanel';
import { TosTrendTab } from '@/components/TosTrendTab';
import { InfoTip } from '@/components/InfoTip';
import { getBreadth, isRegularHours, isSpyRspStale, spyRspSummaryLine } from '@/lib/breadth';
import { breadthSentence } from '@/lib/breadth/wording';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { getScannerView, storeStatus } from '@/lib/scanner';
import { DEFAULT_FILTERS, scoreRow } from '@/lib/scanner/score';
import { SCANNER_TOP_N } from '@/lib/scanner/types';
import { formatEtClock } from '@/lib/scanner/schedule';
import { macroAlignmentFor, earningsWithin24h } from '@/lib/redesign/macroAlignment';
import { getMembership } from '@/lib/rs/membership';
import { sectorMap } from '@/lib/rs/universe';
import { formatAsOf } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Scanner',
  description:
    'The S&P 500 scored 0-100 every morning and ranked, with every component of the score shown on every name — measured, or honestly marked as not measured.',
};

export const dynamic = 'force-dynamic';

interface ScannerPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ScannerPage({ searchParams }: ScannerPageProps) {
  const { tab } = await searchParams;

  /*
    The TOS Trend tab is a separate, owner-only view. Branch before touching any
    scanner data: this tab does none of the scanner's work, and its list is
    fetched client-side behind a cookie so no tickers are ever server-rendered
    without a valid session. The S&P 500 path below is unchanged apart from the
    tabs now sitting beside the title.
  */
  if (tab === 'tos') {
    return (
      <>
        <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
          <PageBar title="Scanner" titleAccessory={<ScannerTabs />} />
          <TosTrendTab />
        </main>
        <Footer />
      </>
    );
  }

  const view = await getScannerView();
  // Reads a stored document, so it costs the scan nothing.
  const breadth = await getBreadth().catch(() => null);
  // GICS sector per name, for the macro-alignment tags (growth / cyclical / …).
  const membership = await getMembership().catch(() => null);
  const sectors = membership ? sectorMap(membership.members) : new Map();
  const store = storeStatus();
  const { scan, latest, gamma, schedule } = view;

  /*
    The macro-alignment panel reads the real top names now, not a hardcoded
    demo set. Each is scored with the same function the board uses and tagged
    against the macro backdrop by `macroAlignmentFor`, so the panel and the list
    below it can never disagree.
  */
  const macroRows: MacroRow[] = scan
    ? [...scan.rows]
        .map((row) => ({
          row,
          total: scoreRow(row, { spyRegime: scan.spyRegime }).total,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 6)
        .map(({ row, total }) => ({
          symbol: row.symbol,
          score: Math.round(total),
          macro: macroAlignmentFor(row.symbol, {
            sector: sectors.get(row.symbol.toUpperCase()) ?? null,
            earningsWithin24h: earningsWithin24h(row.earnings.dateIso),
          }),
        }))
    : [];

  /*
    The one-line summary shown on the collapsed "Data notes" section: how much
    of the index each reading covered, and the time the data is as of. The scan
    time is the honest answer to "how fresh is this" — the readings are taken on
    daily bars and a chain quoted before the open, minutes into the session, not
    at yesterday's 4pm close.
  */
  const earningsDated = scan
    ? scan.rows.filter((r) => r.earnings.state === 'known').length
    : 0;
  const notesSummary = scan
    ? `${scan.coverage?.withGamma ?? 0} of ${scan.scored} names have options data · ` +
      `earnings dates for ${earningsDated} · ` +
      `data as of ${formatEtClock(new Date(scan.scannedAt))}`
    : 'How the score is built, and what each reading covers.';

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {/*
          ## The subtitle names the run, not the ambition

          It read "the S&P 500 scored 0-100" while the line below it said
          thirty names were scored. Both were rendered from the same page and
          they contradicted each other — and the one that was wrong was the one
          in larger type at the top. The static description is now only used
          before the first scan of the day exists, when there is no real number
          to state.
        */}
        <PageBar
          title="Scanner"
          titleAccessory={<ScannerTabs />}
          description={
            scan
              ? `${scan.scored} S&P 500 names scored 0-100 and ranked this morning` +
                (scan.universe > scan.scored
                  ? `, out of ${scan.universe} in the index — the rest had no usable price history or sit below the ranking engine's turnover floor.`
                  : ' — every name in the index.')
              : PAGE_DESCRIPTIONS['/scanner']
          }
          meta={
            scan
              ? `${scan.date} session`
              : latest
                ? `Last run ${latest.date}`
                : 'Not yet run'
          }
          /*
            The run stamp belongs in the labelled slot rather than the loose
            meta text beside it. It is the same string either way; what changes
            is that it now sits under the words "Data as of", which is what a
            first-time reader is looking for when the ranking has not moved
            since they last looked.
          */
          asOfLabel={scan ? formatAsOf(new Date(scan.scannedAt)) : undefined}
        />

        <div className="flex justify-end">
          <RefreshStatus readOnly />
        </div>

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

        {breadth?.spyRsp &&
          !isSpyRspStale(breadth.spyRsp, { marketOpen: isRegularHours() }) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-2xs text-term-faint">
              <span className="label-xs">Big vs average stock</span>
              <InfoTip for="spyRsp" />
              <span className="text-term-text">{spyRspSummaryLine(breadth.spyRsp)}</span>
              <span className="text-term-dim">Context only — it is not part of the score.</span>
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

        {/* Macro alignment column + filters, on the real top names. */}
        <ScannerMacroPanel rows={macroRows} />

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

        {/*
          One collapsed section for everything that is not the list itself:
          today's caveats first, then how the score is built. It used to be a
          stack of yellow warning panels plus a nine-paragraph "How this is
          built" essay, all open on the page above the ranking. Folded here
          behind a one-line summary, it is still one click away but no longer
          the first thing a reader wades through.
        */}
        <details className="panel px-3.5 py-3">
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1 text-2xs leading-relaxed marker:text-term-faint">
            <span className="label-xs">Data notes &amp; how this works</span>
            <span className="text-term-dim">{notesSummary}</span>
          </summary>

          <div className="mt-3 space-y-3 text-2xs leading-relaxed text-term-faint">
            {(scan?.notes.length ||
              (gamma && scan && gamma.date !== scan.date) ||
              (!store.durable && store.note)) && (
              <div className="space-y-1.5">
                <h3 className="label-xs text-flip/80">Today&rsquo;s caveats</h3>
                {scan?.notes.map((note) => (
                  <p key={note} className="text-flip/80">
                    ! {note}
                  </p>
                ))}
                {gamma && scan && gamma.date !== scan.date && (
                  <p className="text-flip/80">
                    ! The stored gamma is dated {gamma.date} and this scan is
                    dated {scan.date}; gamma from another session is treated as
                    absent.
                  </p>
                )}
                {!store.durable && store.note && (
                  <p className="text-flip/80">! {store.note}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <h3 className="label-xs">How the score works</h3>
              <p>
                <span className="text-term-dim">
                  One score, seven components, the whole index.{' '}
                </span>
                Every ranked name gets a 0&ndash;100 composite &mdash; relative
                strength (counted double), trend, volume, distance above its
                daily VWAP, its own dealer gamma, the market&rsquo;s dealer
                gamma, and option liquidity. Each is its own column, so the
                number is checkable; the top {SCANNER_TOP_N} by score always
                show.
              </p>
              <p>
                <span className="text-term-dim">
                  Filters narrow the list; they never empty it.{' '}
                </span>
                The eight filters only mark which rows match your settings &mdash;
                the table shows the top {SCANNER_TOP_N} either way. They open on
                RS {DEFAULT_FILTERS.rsMin} and the turnover floor, live in the
                address bar, and are applied in the browser with no network
                request.
              </p>
              <p>
                <span className="text-term-dim">
                  Unknown is never folded into failed.{' '}
                </span>
                A reading that could not be taken &mdash; no chain pulled, too
                little history &mdash; shows a dash and drops out of the blend
                rather than scoring zero.
              </p>
              <p>
                <span className="text-term-dim">
                  Dealer positioning comes from Polygon.{' '}
                </span>
                The {schedule.gammaEt} ET job pulls the whole index from
                Polygon&rsquo;s options feed, with Cboe as the per-symbol
                fallback. Contracts are graded for the top {view.contractTopN} by
                score; below that a contract reads &ldquo;not checked&rdquo; in
                grey &mdash; unknown, not failed. The grade cautions a row, it
                never moves it up or down.
              </p>
              <p>
                <span className="text-term-dim">
                  A daily VWAP, a market banner, and a chart line.{' '}
                </span>
                VWAP is the volume-weighted average of the last twenty daily
                bars, not the session one. SPY&rsquo;s regime is one component of
                seven, stated once at the top rather than gating each name. The
                Nadaraya-Watson band gates and scores nothing (bandwidth{' '}
                {view.nw.bandwidth}, lookback {view.nw.lookback}, multiplier{' '}
                {view.nw.mult}).
              </p>
              <p>
                <span className="text-term-dim">
                  A ranking is an ordering, and nothing more.{' '}
                </span>
                The top name is the one nothing scored higher than &mdash; not a
                suggestion, and there is no size, target or stop anywhere on the
                page. What the ranking produced afterwards is logged on the{' '}
                <a
                  href="/trackrecord"
                  className="underline decoration-dotted hover:text-term-text"
                >
                  scanner track record
                </a>
                .
              </p>
            </div>
          </div>
        </details>
      </main>

      <Footer />
    </>
  );
}
