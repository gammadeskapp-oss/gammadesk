import { ContextRow } from '@/components/ContextRow';
import { Dashboard } from '@/components/Dashboard';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { PositioningSearch } from '@/components/PositioningSearch';
import { ChainError } from '@/lib/chainSource';
import { config } from '@/lib/config';
import { getPositioningView, normaliseSymbol } from '@/lib/positioning';
import { getBreadth } from '@/lib/breadth';
import type { BreadthReading } from '@/lib/breadth/types';
import { getMarketContextQuotes } from '@/lib/marketContext/quotes';
import type { MarketContextQuotes } from '@/lib/marketContext/quotes';
import { positioningMethodology } from '@/lib/methodology';
import { assessStaleness } from '@/lib/staleness';
import type { PositioningData } from '@/lib/types';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

/**
 * Rendered per request rather than on an ISR interval, because the symbol now
 * comes from the query string and there is no one page to regenerate.
 *
 * That costs an invocation per visit but no upstream traffic: `getPositioningView`
 * is still guarded by the TTL cache, so the default symbol serves the same
 * shared snapshot the forecast uses, and a stock is fetched once per
 * `GAMMADESK_CACHE_SECONDS` however many people ask for it.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ symbol?: string }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const { symbol } = await searchParams;

  // An unusable symbol is reported rather than silently swapped for SPY, so a
  // typo does not look like an answer about the ticker that was typed.
  const requested = (symbol ?? '').trim().toUpperCase();
  const wanted = requested ? normaliseSymbol(requested) : config.symbol;

  let data: PositioningData | null = null;
  let error: { message: string; hint?: string; upstream?: boolean } | null = null;

  /*
   * The market backdrop, fetched alongside the chain and allowed to fail on
   * its own. Breadth is a stored read — the sweep happens on a cron — so it
   * costs a storage read and never an API call. The quotes are one request
   * behind a one-minute cache.
   *
   * Neither can take the page down: a dead quote feed must not cost the reader
   * the positioning they actually came for.
   */
  const [breadth, quotes] = await Promise.all([
    getBreadth().catch((): BreadthReading | null => null),
    getMarketContextQuotes().catch((): MarketContextQuotes | null => null),
  ]);

  if (wanted === null) {
    error = {
      message: `${requested} is not a ticker symbol.`,
      hint: 'US listings are one to five letters, e.g. SPY, AAPL, NVDA.',
    };
  } else {
    try {
      data = await getPositioningView(wanted);
    } catch (e) {
      if (e instanceof ChainError) {
        // Status 0 means the request never completed, and 5xx means the CDN
        // itself is unwell. Neither says anything about the ticker, so the
        // page must not imply the symbol was the problem.
        const upstream = e.status === 0 || e.status >= 500;
        error = {
          message: upstream
            ? "Live data unavailable — couldn't reach the quote service."
            : e.message,
          hint: upstream ? undefined : e.hint,
          upstream,
        };
      } else {
        error = { message: `Could not load the ${wanted} option chain.` };
      }
    }
  }

  return (
    <>
      {data ? (
        <Dashboard
          data={data}
          /*
            Graded against the quote date, not `asOfIso`. `asOfIso` is stamped
            at render time and is therefore always "now" — it would report a
            snapshot as fresh no matter how long the feed had been dead. The
            quote date is the age of the data itself.
          */
          staleness={assessStaleness(data.meta.quoteDateIso)}
          /*
            Built from the snapshot being rendered, so the drawer describes
            this view rather than a general case — see lib/methodology.ts.
          */
          methodology={positioningMethodology(data)}
          contextRow={<ContextRow breadth={breadth} quotes={quotes} />}
        />
      ) : (
        <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
          <PageBar
            title="Dealer Positioning"
            description={PAGE_DESCRIPTIONS['/']}
          />

          <PositioningSearch initial={requested} />

          {/*
            Also on the failure path. When the chain is unreachable the market
            backdrop is the only thing on the page that still works, and it is
            more use than an error message alone.
          */}
          <ContextRow breadth={breadth} quotes={quotes} />

          {error && (
            <div className="panel border-l-2 border-l-bear/60 px-4 py-4">
              <p className="text-xs font-bold text-bear">{error.message}</p>
              {error.hint && (
                <p className="mt-1.5 text-2xs text-term-dim">{error.hint}</p>
              )}
              <p className="mt-3 text-2xs leading-relaxed text-term-faint">
                {error.upstream
                  ? `No positioning is shown because none could be measured. Nothing on this page is estimated or filled in when the feed is down — the numbers are either real or absent. Try again in a few minutes.`
                  : `Not every listed company has an options chain worth reading, and thinly traded ones can return contracts with no open interest at all. Try a more heavily traded name, or go back to ${config.symbol}.`}
              </p>
            </div>
          )}
        </main>
      )}

      <Footer />
    </>
  );
}
