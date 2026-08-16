import { Dashboard } from '@/components/Dashboard';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { PositioningSearch } from '@/components/PositioningSearch';
import { ChainError } from '@/lib/chainSource';
import { config } from '@/lib/config';
import { getPositioningView, normaliseSymbol } from '@/lib/positioning';
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
  let error: { message: string; hint?: string } | null = null;

  if (wanted === null) {
    error = {
      message: `${requested} is not a ticker symbol.`,
      hint: 'US listings are one to five letters, e.g. SPY, AAPL, NVDA.',
    };
  } else {
    try {
      data = await getPositioningView(wanted);
    } catch (e) {
      error =
        e instanceof ChainError
          ? { message: e.message, hint: e.hint }
          : { message: `Could not load the ${wanted} option chain.` };
    }
  }

  return (
    <>
      {data ? (
        <Dashboard data={data} />
      ) : (
        <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
          <PageBar
            title="Dealer Positioning"
            description={PAGE_DESCRIPTIONS['/']}
          />

          <PositioningSearch initial={requested} />

          {error && (
            <div className="panel border-l-2 border-l-bear/60 px-4 py-4">
              <p className="text-xs font-bold text-bear">{error.message}</p>
              {error.hint && (
                <p className="mt-1.5 text-2xs text-term-dim">{error.hint}</p>
              )}
              <p className="mt-3 text-2xs leading-relaxed text-term-faint">
                Not every listed company has an options chain worth reading, and
                thinly traded ones can return contracts with no open interest at
                all. Try a more heavily traded name, or go back to{' '}
                {config.symbol}.
              </p>
            </div>
          )}
        </main>
      )}

      <Footer />
    </>
  );
}
