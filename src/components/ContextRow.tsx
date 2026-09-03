import { BreadthCard } from './BreadthCard';
import { QuoteRow } from './QuoteRow';
import type { BreadthReading } from '@/lib/breadth/types';
import type { MarketContextQuotes } from '@/lib/marketContext/quotes';
import { contextVerdict } from '@/lib/marketContext/verdict';
import { currentMarketStatus } from '@/lib/events';
import { sessionLabel } from '@/lib/staleness';

/**
 * The market backdrop at the top of the home page: breadth, four quotes, and
 * one sentence saying what the pair amounts to.
 *
 * ## The breadth card is the /decision one, unchanged
 *
 * `BreadthCard` is imported, not reimplemented and not forked. It was written
 * to take a single prop, assume nothing about its neighbours, and set no width
 * of its own — precisely so it could be re-parented. A second breadth card
 * with its own thresholds and its own wording is how the same market ends up
 * described two ways on two pages, which is the failure the shared
 * `lib/simple/walls.ts` exists to prevent for levels.
 *
 * ## Where the clock wording comes from
 *
 * Both tiles below are client components and neither may read the clock
 * itself — a `new Date()` during hydration disagrees with the one the server
 * rendered and React throws the subtree away. So the market phase is resolved
 * here, once, and handed down as finished sentences. It also means the two
 * tiles cannot end up describing different market states.
 *
 * ## Why the verdict is below rather than beside
 *
 * It is a claim about both readings. Placed in the row it reads as a third
 * tile — one more thing to scan — rather than as the conclusion drawn from the
 * two above it.
 */
export function ContextRow({
  breadth,
  quotes,
}: {
  breadth: BreadthReading | null;
  quotes: MarketContextQuotes | null;
}) {
  // Nothing to say and nothing to show. Rendering an empty shell would imply
  // the readings were taken and came back unremarkable.
  if (!breadth && !quotes) return null;

  const market = currentMarketStatus();

  /*
   * The quotes carry a fetch time, not a session. Live, the two agree closely
   * enough that the fetch time is the honest stamp; closed, the fetch is from
   * moments ago and the prices in it are last session's closes.
   */
  const quotesAsOf = market.open
    ? 'the live tape'
    : `the ${sessionLabel(market.lastSession.date)} close`;

  const latest = breadth?.computed ?? null;
  const vix = quotes?.quotes.find((q) => q.symbol === '^VIX') ?? null;

  const verdict = contextVerdict({
    breadthPct: latest?.pctAbovePriorClose ?? null,
    vixChangePct: vix?.changePct ?? null,
  });

  return (
    <section aria-label="Market context" className="space-y-2">
      <div className="grid gap-2 md:grid-cols-2">
        {breadth && (
          <BreadthCard
            reading={breadth}
            closedNote={market.open ? undefined : market.nextUpdateLine}
          />
        )}
        {quotes && <QuoteRow data={quotes} asOf={quotesAsOf} />}
      </div>

      <p className="panel px-3.5 py-2.5 text-xs leading-relaxed text-term-dim">
        {verdict}
      </p>
    </section>
  );
}
