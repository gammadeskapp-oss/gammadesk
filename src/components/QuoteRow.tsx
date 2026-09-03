import { AsOfStamp } from './AsOfStamp';
import type { MarketContextQuotes } from '@/lib/marketContext/quotes';

/**
 * SPY, QQQ, IWM and VIX, price and change, in one compact strip.
 *
 * Sits beside the breadth card rather than under it: the two together are the
 * "what is the rest of the market doing" half of the page, and separating them
 * vertically made the verdict line underneath look like it belonged to
 * whichever one it happened to sit closest to.
 */

/** VIX moves the other way round from the index it measures. */
function toneFor(symbol: string, changePct: number): string {
  if (Math.abs(changePct) < 0.05) return 'text-term-dim';
  const good = symbol === '^VIX' ? changePct < 0 : changePct > 0;
  return good ? 'text-bull' : 'text-bear';
}

export function QuoteRow({
  data,
  asOf,
}: {
  data: MarketContextQuotes;
  /**
   * What these four prices are, in words, written on the server.
   *
   * Not the fetch time. Overnight the fetch happened seconds ago and the
   * prices in it are Friday's closes; stamping the fetch would put "16:32"
   * under a set of numbers from the previous week. The caller knows which
   * session the prices belong to and says so.
   */
  asOf?: string;
}) {
  return (
    <div className="panel px-3.5 py-2.5">
      <div className="label-xs">Market</div>

      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {data.quotes.map((quote) => (
          <div key={quote.symbol}>
            <dt className="text-2xs uppercase tracking-[0.14em] text-term-faint">
              {quote.label}
            </dt>
            <dd className="mt-0.5 text-base font-bold tabular-nums text-term-text">
              {quote.price.toFixed(2)}
            </dd>
            <dd
              className={`text-2xs tabular-nums ${toneFor(quote.symbol, quote.changePct)}`}
            >
              {quote.changePct >= 0 ? '+' : ''}
              {quote.changePct.toFixed(2)}%
            </dd>
          </div>
        ))}
      </dl>

      <AsOfStamp label={asOf} subject="This quote row" />

      {data.missing.length > 0 && (
        /*
          Named rather than left as a gap. Four tiles with one missing looks
          like a layout bug; saying which one is absent tells the reader the
          number is unavailable, not zero.
        */
        <p className="mt-2 border-t border-term-line pt-2 text-2xs text-flip/80">
          ! No quote for {data.missing.join(', ')}.
        </p>
      )}
    </div>
  );
}
