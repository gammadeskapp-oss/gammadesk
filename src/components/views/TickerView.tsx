import Link from 'next/link';
import { ConsensusCard } from '@/components/ConsensusCard';
import { LiveFeedNa } from '@/components/lab/LiveFeed';
import { SignalTable } from '@/components/SignalTable';
import { TickerChart } from '@/components/TickerChart';
import { TickerSearch } from '@/components/TickerSearch';
import { analyzeTicker, TickerError } from '@/lib/ticker/analyze';
import type { TickerAnalysis } from '@/lib/ticker/types';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import type { LiveGammaReading } from '@/lib/tasty';
import type { ViewSource } from './source';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel px-4 py-8 text-center text-xs text-term-dim">
      {children}
    </div>
  );
}

/**
 * The Ticker page, as one component, so `/ticker` and the `/lab` Ticker tab
 * render the same thing.
 *
 * This page has no gamma panel, so on `tasty-local` every panel reads its
 * production source exactly as `/ticker` does: the nine signals and the chart
 * run on daily bars, which a live options stream cannot supply. The only
 * differences are where the search box navigates, the "live-feed: n/a"
 * caption, and the chart's current-price line, which takes the feed's spot
 * when the feed is live (never a mock spot).
 */
export async function TickerView({
  symbol,
  source = 'default',
  live,
  searchBasePath,
  searchParams,
}: {
  symbol?: string;
  source?: ViewSource;
  /** The feed reading for this symbol, from `/lab`. */
  live?: LiveGammaReading | null;
  /** Where the search box navigates; defaults to `/ticker`. */
  searchBasePath?: string;
  /** Extra query parameters the search box keeps, e.g. the /lab tab. */
  searchParams?: Record<string, string>;
}) {
  const query = symbol?.trim() ?? '';
  const lab = source === 'tasty-local';

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

        <TickerSearch
          initial={data?.symbol ?? query}
          basePath={searchBasePath}
          params={searchParams}
        />

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
              // Live spot only from the real feed; a mock spot never lands on a real chart.
              currentPrice={lab && live?.mode === 'live' && live.spot !== null ? live.spot : data.price}
            />

            {/*
              Tradeability used to sit beside the consensus here. It now lives
              on the decision page, where the exposure figures it gates are,
              so there is exactly one place on the site that rates it.
            */}
            <ConsensusCard data={data} />

            <SignalTable signals={data.signals} />
            {lab && <LiveFeedNa reason="the nine signals and the chart history run on daily bars, on their existing source" />}

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
    </>
  );
}
