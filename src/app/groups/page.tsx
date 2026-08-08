import type { Metadata } from 'next';
import { CrashCard } from '@/components/CrashCard';
import { Footer } from '@/components/Footer';
import { GroupCard } from '@/components/GroupCard';
import { MarketInternalsStrip } from '@/components/MarketInternals';
import { getForecast } from '@/lib/forecast';
import { getGroupsSnapshot, storeStatus } from '@/lib/groups';
import { formatAsOf } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Group Dashboards',
  description:
    'Model consensus across ticker groups, market internals, and downturn risk.',
};

export const dynamic = 'force-dynamic';

export default async function GroupsPage() {
  const [snapshot, forecast] = await Promise.all([
    getGroupsSnapshot(),
    getForecast().catch(() => null),
  ]);

  const store = storeStatus();

  return (
    <>

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-5 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            Group Dashboards
          </h1>
          {snapshot && (
            <p className="text-2xs text-term-faint">
              {snapshot.groups.length} groups · {snapshot.internals.universe} names ·
              close {snapshot.asOfDate} · computed{' '}
              {formatAsOf(new Date(snapshot.computedAt))}
            </p>
          )}
        </div>

        {!snapshot ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">No group snapshot yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Scores are computed once a day and served from storage rather than
              recalculated per visit. The first run happens on the next
              scheduled refresh, or on the next request to this page.
            </p>
          </div>
        ) : (
          <>
            {forecast && <CrashCard forecast={forecast} />}

            <MarketInternalsStrip internals={snapshot.internals} />

            <section aria-label="Group consensus" className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
                  Model consensus
                </h2>
                <p className="text-2xs text-term-faint">
                  click a group to see each ticker&rsquo;s own score
                </p>
              </div>

              <div className="space-y-2">
                {snapshot.groups.map((group) => (
                  <GroupCard key={group.id} group={group} />
                ))}
              </div>
            </section>

            <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
              <h2 className="label-xs">How this is built</h2>
              <p className="mt-1.5">
                Every ticker runs through the same nine-signal engine as{' '}
                <a href="/ticker" className="text-term-dim underline decoration-dotted">
                  /ticker
                </a>
                . A group&rsquo;s headline label comes from the underlying signal
                votes rather than the count of tickers, so a group of narrow 5/9
                leans does not read as strongly as one of genuine 8/9 calls.
              </p>
              <p className="mt-2">
                <span className="text-term-dim">Why these numbers move slowly. </span>
                Scores are computed once a day and everyone is served the same
                stored copy. Fanning twenty-odd symbols at a price API on every
                page view would be both slow and rate-limited — Polygon allows
                five stock requests a minute even on a paid options plan, so the
                batch runs against a source that tolerates it.
              </p>
              <p className="mt-2">
                <span className="text-term-dim">Breadth is a small universe. </span>
                {snapshot.internals.universe} large, correlated names is not the
                whole market. It says something about megacap and semiconductor
                participation, and very little about small caps or anything
                outside these lists.
              </p>
              {snapshot.notes.map((n) => (
                <p key={n} className="mt-2 text-flip/80">! {n}</p>
              ))}
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
