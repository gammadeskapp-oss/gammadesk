import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { HistoryChart } from '@/components/HistoryChart';
import { PageBar } from '@/components/PageBar';
import { getHistory, WINDOW } from '@/lib/history';
import { BAND_PCT, fraction, sampleCaveat, type LevelStats } from '@/lib/history/build';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { sessionLabel } from '@/lib/staleness';

export const metadata: Metadata = {
  title: 'Level History',
  description: PAGE_DESCRIPTIONS['/history'],
};

export const dynamic = 'force-dynamic';

function StatLine({ stats }: { stats: LevelStats }) {
  if (stats.available === 0) {
    return (
      <li className="leading-relaxed">
        <span className="text-term-text">{stats.label}: </span>
        no day in this window recorded one.
      </li>
    );
  }

  if (stats.reached === 0) {
    return (
      <li className="leading-relaxed">
        <span className="text-term-text">{stats.label}: </span>
        recorded on {fraction(stats.available, stats.available)}, and price never
        reached it on any of them. Nothing to score.
      </li>
    );
  }

  return (
    <li className="leading-relaxed">
      <span className="text-term-text">{stats.label}: </span>
      price reached it on {fraction(stats.reached, stats.available)} it was
      recorded. Of those, it turned there on{' '}
      <span className="text-term-text">{fraction(stats.stopped, stats.reached)}</span>{' '}
      and closed straight through on{' '}
      <span className="text-term-text">
        {fraction(stats.wentThrough, stats.reached)}
      </span>
      .
    </li>
  );
}

export default async function HistoryPage() {
  const history = await getHistory();
  const bandPct = (BAND_PCT * 100).toFixed(1);

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title="Level History"
          description={PAGE_DESCRIPTIONS['/history']}
          /*
           * `collectingSince` is the first session that ever carried a level,
           * and this is the only place it is shown — the archive's age is a
           * different fact from its density, and a reader judging a hit rate
           * off `sampleSize` deserves both.
           */
          meta={
            history.empty
              ? undefined
              : `${history.sampleSize} of the last ${WINDOW} sessions carry recorded levels` +
                (history.collectingSince
                  ? ` · recording since ${sessionLabel(history.collectingSince)}`
                  : '')
          }
          /*
            The newest session on the chart. An archive is as current as its
            last entry, and on a Saturday that is Friday — which is correct and
            worth saying rather than leaving the reader to infer from an axis.
          */
          asOfLabel={
            history.empty
              ? undefined
              : `${history.days[history.days.length - 1]?.date} close`
          }
        />

        {history.empty ? (
          /*
            No history at all. An empty chart reads as a broken page rather
            than as a young one, so the state is named in words instead.

            It used to be named with a date — "Collecting since <today>" —
            built from `new Date().toISOString()`, which was wrong twice over.
            It was the UTC date, so after 20:00 ET it printed tomorrow; and it
            was a date nothing had been recorded on, presented as the day
            collection began. `collectingSince` is the real value and it is
            null here by construction: this branch is `allDates.length === 0`
            and that is the field's own source. So the honest heading names no
            date at all. The conditional stays because the correct fallback for
            a null is not a fabricated date, and that has to be true wherever
            the field is read.
          */
          <div className="panel px-4 py-8 text-center">
            <p className="text-sm font-bold text-term-text">
              {history.collectingSince
                ? `Collecting since ${sessionLabel(history.collectingSince)}`
                : 'Nothing recorded yet'}
            </p>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-term-dim">
              Levels are recorded each weekday morning and settled after the
              close. Nothing has been recorded yet, so there is nothing to plot
              — this page will fill in one session per trading day.
            </p>
          </div>
        ) : (
          <>
            <HistoryChart days={history.days} symbol={history.symbol} />

            <section className="panel px-4 py-4">
              <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-pos">
                What happened at these levels
              </h2>

              <p className="mt-2 text-2xs leading-relaxed text-term-faint">
                &ldquo;Reached&rdquo; means the session&rsquo;s range came within{' '}
                {bandPct}% of the level. &ldquo;Turned there&rdquo; means it
                reached that band and closed back on the side it came from;
                &ldquo;closed straight through&rdquo; means it finished the
                other side. Days where price never got near the level are
                excluded from both counts rather than scored as successes —
                counting them would make any level look good.
              </p>

              <ul className="mt-3 space-y-2 text-xs text-term-dim">
                <StatLine stats={history.stats.stall} />
                <StatLine stats={history.stats.bounce} />
                <li className="leading-relaxed">
                  <span className="text-term-text">
                    {history.stats.flip.label}:{' '}
                  </span>
                  {history.stats.flip.available === 0 ? (
                    'no day in this window recorded one.'
                  ) : (
                    <>
                      price crossed it on{' '}
                      {fraction(history.stats.flip.reached, history.stats.flip.available)}{' '}
                      it was recorded, and closed back on the starting side on{' '}
                      <span className="text-term-text">
                        {fraction(
                          history.stats.flip.stopped,
                          Math.max(history.stats.flip.reached, 1),
                        )}
                      </span>{' '}
                      of those. The flip is a boundary rather than a wall, so it
                      is scored on which side the day finished, not on whether
                      price stopped at it.
                    </>
                  )}
                </li>
              </ul>

              <p className="mt-3 border-t border-term-line pt-3 text-xs font-bold leading-relaxed text-flip">
                {sampleCaveat(history.sampleSize)}
              </p>
            </section>

            <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
              <p>
                <span className="text-term-dim">Where this comes from. </span>
                The levels are the ones the{' '}
                <Link href="/log" className="underline hover:text-term-text">
                  accuracy log
                </Link>{' '}
                records each weekday morning — no separate collection runs for
                this page, so the two can never disagree. Candles are daily bars
                for {history.symbol}
                {history.barsSource ? ` from ${history.barsSource}` : ''}.
              </p>

              {history.legacyDefinitionDays > 0 && (
                <p className="mt-2 text-flip/80">
                  ! {history.legacyDefinitionDays} of these sessions predate
                  2026-08-31 and recorded only the <em>largest</em> magnet strike
                  either side. The site displays the <em>nearest strong</em> wall,
                  which is often a different strike. Those days are plotted with
                  what was actually recorded, so the older marks are not the
                  levels a reader would have seen — the two definitions are
                  mixed in this window and the counts above inherit that.
                </p>
              )}

              <p className="mt-2">
                <span className="text-term-dim">A known bias. </span>A daily bar
                carries no intraday timing, so the high and low include the part
                of the session before the morning snapshot was taken. That
                slightly over-counts both touches and crossings. It is a real
                limitation of free daily data, not a rounding detail.
              </p>

              <p className="mt-2">
                <span className="text-term-dim">What this is not. </span>It is a
                record of what happened, not a backtest and not a result. There
                is no entry, no exit, no cost, and no comparison against what a
                randomly chosen price level would have done over the same
                sessions — which is the comparison that would actually be needed
                to say the levels carry information.
              </p>
            </section>
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
