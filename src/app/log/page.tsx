import type { Metadata } from 'next';
import { AccuracyLogTable } from '@/components/AccuracyLogTable';
import { Footer } from '@/components/Footer';
import { readLog, storeStatus } from '@/lib/log/store';
import { summarise } from '@/lib/log/types';

export const metadata: Metadata = {
  title: 'Accuracy Log',
  description:
    'Daily record of GammaDesk’s gamma flip level and magnet strikes for SPY, settled against the session that followed.',
};

// The log only changes twice a day, but it must never be baked in at build
// time or the page would show whatever existed when the deploy ran.
export const dynamic = 'force-dynamic';

export default async function LogPage() {
  const entries = await readLog();
  const stats = summarise(entries);
  const store = storeStatus();

  return (
    <>

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            Accuracy Log
          </h1>
          <p className="text-2xs text-term-faint">
            {stats.flipHeldPct === null
              ? 'no settled days yet'
              : `Flip held ${stats.flipHeldPct.toFixed(0)}% of days`}
            {' · '}
            {stats.magnetTouchedPct === null
              ? '—'
              : `Magnet touched ${stats.magnetTouchedPct.toFixed(0)}% of days`}
            {' · '}
            {stats.daysTracked} days tracked
          </p>
        </div>

        <AccuracyLogTable entries={entries} stats={stats} />

        <div className="panel px-3 py-2.5 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">How this is scored. </span>
            Each weekday morning the dashboard&rsquo;s gamma flip level and its two
            biggest magnet strikes are recorded. After the close, that day&rsquo;s
            high and low are pulled and judged:{' '}
            <span className="text-pos">HELD</span> means price never crossed to
            the other side of the flip level it started on;{' '}
            <span className="text-neg">BROKE</span> means it did. A magnet counts
            as touched if the session&rsquo;s range reached that strike.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Known bias. </span>
            A daily bar carries no intraday timing, so the high and low include
            the part of the session before the snapshot was taken. That slightly
            over-counts both breaks and touches. It is a real limitation of
            free daily data, not a rounding detail.
          </p>
          {!store.durable && store.note && (
            <p className="mt-2 text-flip/80">! {store.note}</p>
          )}
        </div>
      </main>

      <Footer />
    </>
  );
}
