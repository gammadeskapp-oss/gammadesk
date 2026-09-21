import Link from 'next/link';
import { COVERAGE } from '@/lib/daily/coverage';

/**
 * The "other tickers" chip row, shown on /daily and every ticker page so a
 * reader can hop between the covered names without going back to search.
 *
 * `current` is the symbol whose page we are on, so it renders as plain text
 * rather than a link to itself. SPY's own page is /daily (not /daily/SPY), so
 * SPY always points there.
 */
export function TickerLinks({ current }: { current?: string }) {
  const active = (current ?? '').toUpperCase();

  return (
    <section className="space-y-3">
      <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-faint">
        Other tickers
      </h2>
      <div className="flex flex-wrap gap-2">
        {COVERAGE.map(({ symbol }) => {
          const href = symbol === 'SPY' ? '/daily' : `/daily/${symbol}`;
          const isCurrent = symbol === active || (active === '' && symbol === 'SPY');
          if (isCurrent) {
            return (
              <span
                key={symbol}
                aria-current="page"
                className="rounded border border-pos/50 bg-pos/[0.08] px-2.5 py-1 text-2xs font-bold tabular-nums text-pos"
              >
                {symbol}
              </span>
            );
          }
          return (
            <Link
              key={symbol}
              href={href}
              className="rounded border border-term-line px-2.5 py-1 text-2xs font-bold tabular-nums text-term-dim transition-colors hover:border-pos/40 hover:text-term-text"
            >
              {symbol}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
