import { formatPrice } from '@/lib/format';
import { strengthDots, type RankedTicker } from '@/lib/groups/ranking';

/** Three dots, filled according to the ticker's vote share. */
function Dots({
  bullish,
  total,
  tone,
}: {
  bullish: number;
  total: number;
  tone: 'bull' | 'bear';
}) {
  const filled = strengthDots(bullish, total);
  const on = tone === 'bull' ? 'bg-bull' : 'bg-bear';

  return (
    <span
      className="flex items-center gap-1"
      role="img"
      aria-label={`Strength ${filled} of 3`}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= filled ? on : 'bg-term-line'}`}
        />
      ))}
    </span>
  );
}

function Tile({ item, tone }: { item: RankedTicker; tone: 'bull' | 'bear' }) {
  const accent = tone === 'bull' ? 'text-bull' : 'text-bear';
  const edge = tone === 'bull' ? 'border-l-bull/60' : 'border-l-bear/60';

  return (
    <div className={`panel border-l-2 ${edge} px-3 py-2.5`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold tracking-[0.1em] text-term-text">
          {item.symbol}
        </span>
        <span className={`text-lg font-bold tabular-nums leading-none ${accent}`}>
          {item.score}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-2xs tabular-nums text-term-dim">
          {formatPrice(item.price)}
        </span>
        <span
          className={`text-2xs tabular-nums ${
            item.changePct >= 0 ? 'text-bull' : 'text-bear'
          }`}
        >
          {item.changePct >= 0 ? '+' : ''}
          {(item.changePct * 100).toFixed(2)}%
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Dots bullish={item.bullish} total={item.total} tone={tone} />
        <span className="text-2xs text-term-faint">
          #{item.rank} · {item.bullish}/{item.total}
        </span>
      </div>
    </div>
  );
}

export function StrengthTiles({
  title,
  subtitle,
  items,
  tone,
}: {
  title: string;
  subtitle: string;
  items: RankedTicker[];
  tone: 'bull' | 'bear';
}) {
  const accent = tone === 'bull' ? 'text-bull' : 'text-bear';

  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={`text-2xs font-bold uppercase tracking-[0.18em] ${accent}`}>
          {title}
        </h2>
        <p className="text-2xs text-term-faint">{subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <Tile key={item.symbol} item={item} tone={tone} />
        ))}
      </div>
    </section>
  );
}
