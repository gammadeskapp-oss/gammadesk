import { formatPrice } from '@/lib/format';
import type { GroupScore } from '@/lib/groups/types';
import { TickerLink } from './TickerLink';

const TONE = {
  BULLISH: { text: 'text-bull', edge: 'border-l-bull/60' },
  BEARISH: { text: 'text-bear', edge: 'border-l-bear/60' },
  NEUTRAL: { text: 'text-flip', edge: 'border-l-flip/60' },
} as const;

/** Segmented bar of every signal vote in the group. */
function VoteBar({ bullish, total }: { bullish: number; total: number }) {
  const pct = total > 0 ? (bullish / total) * 100 : 0;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden bg-bear"
      role="img"
      aria-label={`${bullish} of ${total} signals bullish`}
    >
      <div className="h-full bg-bull" style={{ width: `${pct.toFixed(2)}%` }} />
    </div>
  );
}

function MiniBar({ bullish, total }: { bullish: number; total: number }) {
  return (
    <span className="flex gap-px" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-2.5 w-1 ${i < bullish ? 'bg-bull' : 'bg-bear'}`}
        />
      ))}
    </span>
  );
}

export function GroupCard({ group }: { group: GroupScore }) {
  const tone = TONE[group.label];

  return (
    <details className={`panel group border-l-2 ${tone.edge}`}>
      <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div>
            <div className="flex items-baseline gap-2.5">
              <h3 className="text-lg font-bold tracking-[0.16em] text-term-text">
                {group.name}
              </h3>
              <span className="text-2xs text-term-faint transition-transform group-open:hidden">
                ▸ expand
              </span>
              <span className="hidden text-2xs text-term-faint group-open:inline">
                ▾ collapse
              </span>
            </div>
            <p className="mt-1 max-w-md text-2xs leading-relaxed text-term-faint">
              {group.blurb}
            </p>
          </div>

          <div className="text-right">
            <div className={`text-2xl font-bold tabular-nums leading-none ${tone.text}`}>
              {group.bullishTickers}
              <span className="text-base text-term-faint"> of {group.totalTickers}</span>
            </div>
            <div className={`mt-1 text-xs font-bold tracking-[0.16em] ${tone.text}`}>
              {group.label}
            </div>
            <div className="mt-0.5 text-2xs text-term-faint">
              {group.bullishSignals}/{group.totalSignals} signals bullish
            </div>
          </div>
        </div>

        <div className="mt-3.5">
          <VoteBar bullish={group.bullishSignals} total={group.totalSignals} />
        </div>
      </summary>

      <div className="border-t border-term-line">
        <table className="w-full text-right text-xs tabular-nums">
          <caption className="sr-only">
            Individual scores for each ticker in {group.name}.
          </caption>
          <thead>
            <tr className="text-2xs uppercase tracking-[0.1em] text-term-faint">
              <th scope="col" className="px-3.5 py-2 text-left font-normal">Ticker</th>
              <th scope="col" className="px-2 py-2 font-normal">Price</th>
              <th scope="col" className="px-2 py-2 font-normal">Chg</th>
              <th scope="col" className="px-2 py-2 font-normal">Score</th>
              <th scope="col" className="px-3.5 py-2 text-left font-normal">Votes</th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((m) => (
              <tr key={m.symbol} className="border-t border-term-line/60">
                <th scope="row" className="px-3.5 py-1.5 text-left font-bold text-term-text">
                  <TickerLink symbol={m.symbol} />
                </th>
                <td className="px-2 py-1.5 text-term-dim">{formatPrice(m.price)}</td>
                <td
                  className={`px-2 py-1.5 ${m.changePct >= 0 ? 'text-bull' : 'text-bear'}`}
                >
                  {m.changePct >= 0 ? '+' : ''}
                  {(m.changePct * 100).toFixed(2)}%
                </td>
                <td
                  className={`px-2 py-1.5 font-bold ${
                    m.vote === 'bullish' ? 'text-bull' : 'text-bear'
                  }`}
                >
                  {m.bullish}/{m.total}
                </td>
                <td className="px-3.5 py-1.5 text-left">
                  <MiniBar bullish={m.bullish} total={m.total} />
                </td>
              </tr>
            ))}

            {group.failures.map((f) => (
              <tr key={f.symbol} className="border-t border-term-line/60">
                <th scope="row" className="px-3.5 py-1.5 text-left font-bold text-term-faint">
                  {f.symbol}
                </th>
                <td colSpan={4} className="px-2 py-1.5 text-left text-2xs text-flip/80">
                  {f.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
