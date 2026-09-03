import { ContextRow } from '@/components/ContextRow';
import { EventRiskRow } from '@/components/EventRiskRow';
import { Dashboard } from '@/components/Dashboard';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { PositioningSearch } from '@/components/PositioningSearch';
import { ResearchCards } from '@/components/ResearchCards';
import { ChainError } from '@/lib/chainSource';
import { config } from '@/lib/config';
import { buildGammaProfile } from '@/lib/gammaProfile';
import { getPositioningView, normaliseSymbol } from '@/lib/positioning';
import { getBreadth } from '@/lib/breadth';
import type { BreadthReading } from '@/lib/breadth/types';
import { getMarketContextQuotes } from '@/lib/marketContext/quotes';
import type { MarketContextQuotes } from '@/lib/marketContext/quotes';
import { positioningMethodology } from '@/lib/methodology';
import { researchLine } from '@/lib/simple/research';
import { moodOf } from '@/lib/simple/translate';
import {
  eventRow,
  highImportanceToday,
  priorSessionDate,
  snapshotStaleness,
} from '@/lib/events';
import { readLog } from '@/lib/log/store';
import { readArchive } from '@/lib/scanner/archive';
import { marketToday } from '@/lib/time';
import { buildWhatChanged } from '@/lib/whatChanged';
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
  /*
   * Straight off a JSON file compiled into the bundle — no fetch, no store, no
   * failure mode worth a try/catch.
   */
  const events = eventRow();
  const highToday = highImportanceToday();

  const [breadth, quotes, log, archive] = await Promise.all([
    getBreadth().catch((): BreadthReading | null => null),
    getMarketContextQuotes().catch((): MarketContextQuotes | null => null),
    /*
      Two stored reads for the what-changed lines. Both are allowed to fail on
      their own and both degrade to an empty list, which renders nothing —
      never a partial comparison. A dead store must cost the reader the card,
      not the page.
    */
    readLog().catch(() => []),
    readArchive().catch(() => []),
  ]);

  /*
    The previous TRADING day, from the market calendar — not today minus one.
    Subtracting a calendar day lands on Sunday every Monday, and the card would
    go blank once a week for a reason that has nothing to do with the data.
  */
  const today = marketToday();
  const prior = priorSessionDate(today);

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
        /*
          `publicMessage`, never `message`. The adapter's own text names the
          provider and the HTTP status — right for a log, wrong for a page.
          See `ChainError` in lib/chainSource.ts.

          Status 0 means the request never completed and 5xx means the provider
          itself is unwell. Neither says anything about the ticker, so the page
          must not imply the symbol was the problem.
        */
        const upstream = e.status === 0 || e.status >= 500;
        error = { message: e.publicMessage, upstream };
      } else {
        error = { message: "Today's data isn't available yet." };
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
          staleness={snapshotStaleness(data.meta.quoteDateIso)}
          /*
            Built from the snapshot being rendered, so the drawer describes
            this view rather than a general case — see lib/methodology.ts.
          */
          methodology={positioningMethodology(data)}
          /*
            The strike profile, shaped on the server and memoised against this
            snapshot — see lib/gammaProfile.ts. The chart is handed the flip
            level and both magnets as prices rather than deriving its own, so
            it cannot draw a line the text above it does not name.
          */
          profile={buildGammaProfile(data)}
          /*
            The one line under the verdict. Built here rather than in the
            client component because it needs the breadth reading, which is
            fetched on this page — and because keeping it pure and server-side
            is what lets `verify:research` walk every combination of it.

            Mood comes from `translate.ts`'s own `moodOf`, not from a second
            reading of the regime, so the line and the headline above it cannot
            disagree about whether today is calm or wild.
          */
          researchLine={researchLine({
            mood: moodOf({
              regime: data.summary.regime,
              aboveFlip:
                data.summary.flipLevel === null
                  ? null
                  : data.summary.spot > data.summary.flipLevel,
            }),
            breadthPct: breadth?.computed?.pctAbovePriorClose ?? null,
          })}
          /*
            Built server-side so the diff is a pure function of two stored
            snapshots and `verify:what-changed` can walk it.

            The accuracy log only ever holds the tracked symbol, so its line is
            withheld on any other ticker rather than being compared against a
            different company's history. The scanner archive is market-wide and
            applies either way.
          */
          whatChanged={buildWhatChanged({
            symbol: wanted ?? config.symbol,
            today,
            prior,
            log: wanted === config.symbol ? log : [],
            archive,
          })}
          contextRow={
            <>
              <ContextRow breadth={breadth} quotes={quotes} />
              <EventRiskRow events={events} highToday={highToday} />
            </>
          }
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
          <EventRiskRow events={events} highToday={highToday} />

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
              {/*
                Only on the upstream path. A ticker with no listed chain is not
                an outage, and pointing that reader at the job list would send
                them looking for a fault that is not there.
              */}
              {error.upstream && (
                <p className="mt-2 text-2xs text-term-faint">
                  <a
                    href="/status"
                    className="underline decoration-dotted underline-offset-2 hover:text-term-dim"
                  >
                    What&rsquo;s running, and what isn&rsquo;t
                  </a>
                </p>
              )}
            </div>
          )}

          {/*
            Also on the failure path. When the chain is down the reader still
            came here to research something, and a dead-end page with one error
            message on it is the worst possible front door.
          */}
          <ResearchCards />
        </main>
      )}

      <Footer />
    </>
  );
}
