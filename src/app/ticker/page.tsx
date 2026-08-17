import type { Metadata } from 'next';
import Link from 'next/link';
import { ConsensusCard } from '@/components/ConsensusCard';
import { Footer } from '@/components/Footer';
import { SignalTable } from '@/components/SignalTable';
import { TickerChart } from '@/components/TickerChart';
import { TickerSearch } from '@/components/TickerSearch';
import { analyzeTicker, TickerError } from '@/lib/ticker/analyze';
import type { TickerAnalysis } from '@/lib/ticker/types';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Ticker Consensus',
  description:
    'Nine technical signals vote bullish or bearish on any US ticker.',
};

interface PageProps {
  searchParams: Promise<{ symbol?: string }>;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel px-4 py-8 text-center text-xs text-term-dim">
      {children}
    </div>
  );
}

export default async function TickerPage({ searchParams }: PageProps) {
  const { symbol } = await searchParams;
  const query = symbol?.trim() ?? '';

  let data: TickerAnalysis | null = null;
  let error: { message: string; hint?: string } | null = null;

  if (query) {
    try {
      data = await analyzeTicker(query);
    } catch (e) {
      error =
        e instanceof TickerError
          ? { message: e.message, hint: e.hint }
          : { message: 'Could not analyse that ticker.' };
    }
  }

  return (
    <>

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Ticker Consensus
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/ticker']}
            </p>
          </div>
          {data && (
            <p className="text-2xs text-term-faint">
              {data.barsUsed} daily bars · {data.source} · close {data.asOfDate}
            </p>
          )}
        </div>

        <TickerSearch initial={data?.symbol ?? query} />

        {error && (
          <div className="panel border-l-2 border-l-bear/60 px-4 py-4">
            <p className="text-xs font-bold text-bear">{error.message}</p>
            {error.hint && (
              <p className="mt-1.5 text-2xs text-term-dim">{error.hint}</p>
            )}
          </div>
        )}

        {!query && !error && (
          <Panel>
            <p className="text-term-text">Enter a US ticker to see the consensus.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Nine independent technical signals each vote bullish or bearish on
              about a year of daily price history. How easily the name can
              actually be traded is rated on the{' '}
              <Link
                href="/decision"
                className="text-pos underline decoration-dotted"
              >
                decision
              </Link>{' '}
              page.
            </p>
          </Panel>
        )}

        {data && (
          <>
            {/* Price first, score second — the chart is the context the
                consensus is meant to be read against. */}
            <TickerChart
              symbol={data.symbol}
              data={data.chart}
              currentPrice={data.price}
            />

            {/*
              Tradeability used to sit beside the consensus here. It now lives
              on the decision page, where the exposure figures it gates are,
              so there is exactly one place on the site that rates it.
            */}
            <ConsensusCard data={data} />

            <SignalTable signals={data.signals} />

            <div className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
              <p>
                <span className="text-term-dim">How to read this. </span>
                These are nine ways of describing the same price history, so
                they are not independent opinions — in a strong trend most of
                them will agree almost by construction. The count is a summary
                of what the chart already looks like, not a forecast, and none
                of it accounts for earnings, news or valuation.
              </p>
              <p className="mt-2">
                <span className="text-term-dim">On the volume signal. </span>
                Rising volume is counted as bullish, per the standard reading,
                but volume confirms conviction rather than direction — heavy
                volume into a decline is not a positive.
              </p>
              <p className="mt-2">
                Prices are end-of-day and delayed. Cached for{' '}
                {Math.round(data.cachedForSeconds / 60)} minutes, so a repeat
                search costs nothing upstream.
              </p>
            </div>
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
