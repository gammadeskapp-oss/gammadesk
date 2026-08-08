import { StarButton } from './StarButton';
import { formatPrice } from '@/lib/format';
import type { TickerAnalysis } from '@/lib/ticker/types';

/** Segmented bar showing the split of votes at a glance. */
function VoteBar({ bullish, total }: { bullish: number; total: number }) {
  return (
    <div
      className="flex gap-0.5"
      role="img"
      aria-label={`${bullish} of ${total} signals bullish`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 ${i < bullish ? 'bg-bull' : 'bg-bear'}`}
        />
      ))}
    </div>
  );
}

export function ConsensusCard({ data }: { data: TickerAnalysis }) {
  const { consensus, price, changePct, high52, low52 } = data;
  const bullish = consensus.vote === 'bullish';

  const accent = bullish ? 'text-bull' : 'text-bear';
  const edge = bullish ? 'border-l-bull/60' : 'border-l-bear/60';

  return (
    <section
      aria-label="Model consensus"
      className={`panel border-l-2 ${edge} p-5`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[0.14em] text-term-text">
              {data.symbol}
              <StarButton symbol={data.symbol} />
            </h1>
            <span className="text-lg tabular-nums text-term-dim">
              {formatPrice(price)}
            </span>
            <span
              className={`text-xs tabular-nums ${
                changePct >= 0 ? 'text-bull' : 'text-bear'
              }`}
            >
              {changePct >= 0 ? '+' : ''}
              {(changePct * 100).toFixed(2)}%
            </span>
          </div>
          {data.name && (
            <p className="mt-1 text-2xs text-term-faint">{data.name}</p>
          )}
          <p className="mt-2 text-2xs text-term-faint">
            52-week range {formatPrice(low52)} – {formatPrice(high52)}
          </p>
        </div>

        <div className="text-right">
          <div className={`text-5xl font-bold tabular-nums leading-none ${accent}`}>
            {consensus.bullish}
            <span className="text-2xl text-term-faint">/{consensus.total}</span>
          </div>
          <div className={`mt-1.5 text-sm font-bold tracking-[0.18em] ${accent}`}>
            {consensus.label}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <VoteBar bullish={consensus.bullish} total={consensus.total} />
        <div className="mt-2 flex justify-between text-2xs">
          <span className="text-bull">
            {consensus.bullish} bullish
          </span>
          <span className="text-bear">{consensus.bearish} bearish</span>
        </div>
      </div>

      {consensus.label.startsWith('LEAN') && (
        <p className="mt-4 border-t border-term-line pt-3 text-2xs leading-relaxed text-term-faint">
          A near-even split means the signals disagree. Read that as{' '}
          <span className="text-term-dim">no clear edge</span> rather than a
          weak call in either direction.
        </p>
      )}
    </section>
  );
}
