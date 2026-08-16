import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { RsBoard } from '@/components/RsBoard';
import { getRsInputs, storeStatus } from '@/lib/rs';
import { peekStoredSectors, toSectorPulse } from '@/lib/sectors';
import { formatAsOf } from '@/lib/time';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Relative Strength',
  description:
    'Every S&P 500 stock ranked 0-100 by how much it is outperforming the rest of the market over 1, 3 and 6 months.',
};

export const dynamic = 'force-dynamic';

/**
 * The RS engine.
 *
 * The server reads storage and hands down the digest entries; the ranking
 * itself happens in `components/RsBoard.tsx`, which is a client component and
 * so still server-renders the full table on first load. That split exists
 * because the liquidity floor decides which stocks are in the percentile pool
 * — see the note there.
 */
export default async function StrengthPage() {
  /*
   * The sector snapshot is read with `peek` rather than `get`: it decorates
   * the group selector and drives the detail tile, and a secondary reading on
   * this page must never be the thing that triggers a sector recompute. If the
   * /sectors job has not run, the chips stay neutral and the tile says so.
   */
  const [result, sectorMomentum] = await Promise.all([
    getRsInputs(),
    peekStoredSectors().catch(() => null),
  ]);
  const store = storeStatus();

  const hasData = result.entries.length > 0;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Relative Strength
            </h1>
            {/* Directly under the title, because the confusion it heads off —
                a 95 sitting beside a red daily change — happens on first
                glance, before anyone reaches the "How to use this" panel. */}
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-flip">
              Strength is measured over months — today&rsquo;s move doesn&rsquo;t
              change it much.
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/strength']}
            </p>
          </div>
          {hasData && (
            <p className="text-2xs text-term-faint">
              {result.entries.length} of {result.universe} with history
              {result.universe > result.entries.length && (
                <span className="text-flip">
                  {' '}
                  · {result.universe - result.entries.length} still loading
                </span>
              )}{' '}
              · close {result.asOfDate} · computed{' '}
              {formatAsOf(new Date(result.computedAt))}
            </p>
          )}
        </div>

        {/* Above the data, because it changes how every number below should be
            read. Broken into parts rather than one paragraph — the last one is
            the part people skip, and it is the one that matters most. */}
        <section
          aria-label="How to use this"
          className="panel border-2 border-pos/50 bg-pos/[0.04]"
        >
          <div className="border-b border-pos/25 px-4 py-2.5">
            <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-pos">
              How to use this
            </h2>
          </div>

          <dl className="divide-y divide-term-line/70 text-sm leading-relaxed">
            <div className="px-4 py-3">
              <dt className="font-bold text-pos">What it is</dt>
              <dd className="mt-1 text-term-text">
                Relative Strength ranks every S&amp;P 500 stock by how much it is
                outperforming the rest of the market.
              </dd>
            </div>

            <div className="px-4 py-3">
              <dt className="font-bold text-bull">Leaders</dt>
              <dd className="mt-1 text-term-text">
                Where money is flowing. Shop for ideas here, not the whole
                market.
              </dd>
            </div>

            <div className="px-4 py-3">
              <dt className="font-bold text-bear">Laggards</dt>
              <dd className="mt-1 text-term-text">
                Weak. Avoid buying just because they look cheap.
              </dd>
            </div>

            <div className="px-4 py-3">
              <dt className="font-bold text-term-text">Rising and falling</dt>
              <dd className="mt-1 text-term-text">
                A <span className="text-bull">rising</span> score means strength
                is building. <span className="text-bear">Falling</span> means
                strength is fading.
              </dd>
            </div>

            <div className="px-4 py-3">
              <dt className="font-bold text-flip">What it is not</dt>
              <dd className="mt-1 text-term-text">
                This shows what <span className="text-flip">has</span> been
                strong — it is backward-looking. A shortlist to research, not a
                buy signal.
              </dd>
            </div>
          </dl>
        </section>

        {!hasData ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">No ranking yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              The price history is built one quarter of the index at a time by a
              nightly job, so this fills in over the first few runs. Nothing is
              wrong — there is simply no stored history to rank yet.
            </p>
            {result.notes.length > 0 && (
              <ul className="mx-auto mt-4 max-w-xl space-y-1 text-left text-2xs text-flip/80">
                {result.notes.map((n) => (
                  <li key={n}>! {n}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <Suspense fallback={<div className="panel h-64 animate-pulse" aria-hidden />}>
            <RsBoard
              entries={result.entries}
              sectors={result.sectors}
              signals={result.signals}
              asOfDate={result.asOfDate}
              sectorPulse={sectorMomentum?.sectors.map(toSectorPulse) ?? null}
            />
          </Suspense>
        )}

        {hasData && (
          <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
            <h2 className="label-xs">How the score works</h2>
            <p className="mt-1.5">
              Each stock&rsquo;s 1-month, 3-month and 6-month performance is
              ranked against every other name in the index, giving three
              percentiles. Those are blended into one 0&ndash;100 score at the
              weights set above &mdash;{' '}
              <span className="text-term-dim">3mo 50%, 6mo 30%, 1mo 20%</span> by
              default. Three windows rather than one so a single hot week cannot
              carry a name to the top.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">A rank, not a return. </span>
              A score of 90 means the stock beat 90% of the index, and says
              nothing about whether it went up. In a falling market the leaders
              are simply the names falling least. Check the raw performance
              printed beside each percentile before reading a high score as a
              gain.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">Group filtering never changes a score. </span>
              Percentiles are computed across the whole index, so narrowing to a
              sector or to MAG7 shows those names carrying the ranks they earned
              against every other constituent. A defensive name does not become
              strong for being the best of eleven utilities.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">The liquidity floor is the one filter that does. </span>
              Names trading under the floor are dropped{' '}
              <span className="text-term-dim">before</span> ranking, not hidden
              after it. That is deliberate: a thin stock can post the best
              six-month return in the index on volume nobody could have
              participated in, and leaving it in the pool would push every
              tradeable name down a place. Set the floor to{' '}
              <span className="text-term-dim">Any</span> to see what it is
              removing.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">Confirmed vs unconfirmed. </span>
              Compares the last month&rsquo;s average volume against the three
              months before it. Confirmed means the move drew participation;
              unconfirmed means it happened on thinning volume, which is the
              shape of a drift that reverses. It describes the{' '}
              <span className="text-term-dim">move</span>, not the direction — a
              laggard marked confirmed is falling on heavy volume, which makes
              the weakness more credible rather than less. Names without enough
              volume history show a dash, because &ldquo;we cannot tell&rdquo;
              and &ldquo;unconfirmed&rdquo; are different statements.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">Rising and falling. </span>
              Today&rsquo;s score against the same score five sessions ago,
              recomputed from the price history rather than remembered &mdash; so
              a missed nightly run leaves no gap. Because the measure is
              relative, a score can fall on a week the stock rose; that means
              the rest of the market rose more. Moves under two points are shown
              as flat, which is roughly ten places in a 500-name index and
              inside the noise of a quiet week.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">RSI is a different comparison. </span>
              Off by default, switched on above. RSI measures a stock against{' '}
              <span className="text-term-dim">its own</span> recent moves rather
              than against the market: over 70 it is stretched high and may be due
              a pullback, under 30 it is stretched low. That makes it orthogonal
              to the RS score beside it — a genuine leader can sit above 70 for
              months while the trend runs, so read it as a stretch reading rather
              than a signal to act on. Computed over 14 of the stock&rsquo;s own
              sessions, the same RSI(14) drawn on{' '}
              <Link href="/ticker" className="text-term-dim underline decoration-dotted">
                /ticker
              </Link>
              . The column is offered only once every ranked name has an RSI:
              the price history is refreshed a quarter of the index a night, and
              a column that were RSI for some rows and blank for others would
              invite reading the blank as a fact about the stock rather than
              about our storage.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">The nine-signal score is a different question. </span>
              RS asks &ldquo;is this beating the market?&rdquo;. The nine-signal
              score, from the same engine as{' '}
              <Link href="/ticker" className="text-term-dim underline decoration-dotted">
                /ticker
              </Link>
              , asks &ldquo;is this stock&rsquo;s own trend healthy?&rdquo;. A
              name can lead the index while its own trend is deteriorating.
              Coverage is partial &mdash; it is computed by the{' '}
              <Link href="/sectors" className="text-term-dim underline decoration-dotted">
                /sectors
              </Link>{' '}
              and groups jobs, which track a smaller universe &mdash; so most
              rows show a dash rather than a made-up number.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">Data. </span>
              Daily closes and volumes from Yahoo, held for up to ten years.
              Splits are applied from the upstream&rsquo;s own event feed, since
              its price history is <span className="text-term-dim">not</span>{' '}
              retroactively adjusted for a recent one — left alone, a stock that
              split 2-for-1 last week reads as having halved. Dividends are
              deliberately not adjusted for: that would fold a utility&rsquo;s
              payouts into its &ldquo;performance&rdquo; and a non-payer&rsquo;s
              not, which is a total-return view rather than a momentum one. The index membership list is refetched
              weekly from Wikipedia, with a maintained CSV as a fallback and a
              plausibility check that rejects a list which has changed too much
              to be real. A quarter of the universe is refreshed per run, four
              runs an evening, so the whole index updates daily without ever
              fetching 500 symbols at once.
            </p>
            {result.notes.map((n) => (
              <p key={n} className="mt-2 text-flip/80">! {n}</p>
            ))}
            {!store.durable && store.note && (
              <p className="mt-2 text-flip/80">! {store.note}</p>
            )}
          </section>
        )}

        <p className="px-1 text-2xs leading-relaxed text-term-faint">
          Backward-looking by construction: every number here describes
          performance that has already happened. Nothing on this page is
          investment advice, a recommendation, or a prediction.
        </p>
      </main>

      <Footer />
    </>
  );
}
