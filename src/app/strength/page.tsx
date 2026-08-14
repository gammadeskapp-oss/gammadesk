import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { StrengthTable } from '@/components/StrengthTable';
import { StrengthTiles } from '@/components/StrengthTiles';
import { getGroupsSnapshot, storeStatus } from '@/lib/groups';
import {
  rankTickers,
  splitLeadersLaggards,
  toCsv,
  toPlainList,
} from '@/lib/groups/ranking';
import { formatAsOf } from '@/lib/time';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Relative Strength',
  description:
    'Every tracked ticker ranked by a 0-100 composite strength score from the nine-signal engine.',
};

export const dynamic = 'force-dynamic';

export default async function StrengthPage() {
  const snapshot = await getGroupsSnapshot();
  const store = storeStatus();

  const ranked = snapshot ? rankTickers(snapshot) : [];
  const { leaders, laggards } = splitLeadersLaggards(ranked, 10);

  return (
    <>

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-5 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Relative Strength
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/strength']}
            </p>
          </div>
          {snapshot && (
            <p className="text-2xs text-term-faint">
              {ranked.length} tickers · close {snapshot.asOfDate} · computed{' '}
              {formatAsOf(new Date(snapshot.computedAt))}
            </p>
          )}
        </div>

        {!snapshot || ranked.length === 0 ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">No ranking yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Strength is derived from the same daily group snapshot that powers{' '}
              <Link href="/sectors?view=groups" className="text-term-dim underline decoration-dotted">
                /sectors
              </Link>
              . It appears once that has been computed.
            </p>
          </div>
        ) : (
          <>
            <StrengthTiles
              title="Leaders"
              subtitle={`top ${leaders.length} by composite score`}
              items={leaders}
              tone="bull"
            />

            <StrengthTiles
              title="Laggards"
              subtitle={`bottom ${laggards.length}, weakest first`}
              items={laggards}
              tone="bear"
            />

            <StrengthTable
              ranked={ranked}
              csv={toCsv(ranked)}
              list={toPlainList(ranked)}
              asOfDate={snapshot.asOfDate}
            />

            <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
              <h2 className="label-xs">How the score works</h2>
              <p className="mt-1.5">
                Every ticker runs through the same nine-signal engine as{' '}
                <a href="/ticker" className="text-term-dim underline decoration-dotted">
                  /ticker
                </a>
                . The score is simply the share of those signals voting
                bullish, scaled to 0&ndash;100.
              </p>
              <p className="mt-2">
                <span className="text-term-dim">It is a coarse score, on purpose. </span>
                Nine signals give only ten possible values, so scores cluster
                heavily and a 78 sits one signal above a 67 — not eleven points
                above it in any meaningful sense. Ties are broken on 20-day
                momentum so the ordering is at least stable and not
                alphabetical, but two names a rank apart are usually
                indistinguishable.
              </p>
              <p className="mt-2">
                <span className="text-term-dim">This is relative to a small list. </span>
                Strength here means strength against the {ranked.length} names
                in the tracked groups, not against the market. A leader in a
                weak universe is still weak in absolute terms — check{' '}
                <Link href="/sectors?view=groups" className="text-term-dim underline decoration-dotted">
                  market internals
                </Link>{' '}
                for that context.
              </p>
              <p className="mt-2">
                Computed once a day and served from storage, so repeated visits
                cost nothing upstream. Add or change the universe in{' '}
                <span className="text-term-dim">src/lib/groups/definitions.ts</span>.
              </p>
              {!store.durable && store.note && (
                <p className="mt-2 text-flip/80">! {store.note}</p>
              )}
            </section>
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
