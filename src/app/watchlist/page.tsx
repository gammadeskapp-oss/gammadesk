import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { WatchlistView } from '@/components/WatchlistView';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Watchlist',
  description: 'Your starred tickers and their nine-signal scores.',
};

export default function WatchlistPage() {
  return (
    <>

      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Watchlist
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/watchlist']}
            </p>
          </div>
          <p className="text-2xs text-term-faint">stored in this browser only</p>
        </div>

        <WatchlistView />

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">Where this lives. </span>
            There is no login yet, so the list is kept in this browser&rsquo;s
            local storage. It is per-device: it will not follow you to your
            phone, and clearing site data or using a private window loses it.
            Nothing about the list is stored on a server — symbols are only
            sent when scores are fetched, and are not recorded.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Scores are the same nine signals. </span>
            Each is the share of signals voting bullish, scaled to
            0&ndash;100 — identical to{' '}
            <a href="/strength" className="text-term-dim underline decoration-dotted">
              /strength
            </a>
            , and just as coarse. Cached for an hour per symbol.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
