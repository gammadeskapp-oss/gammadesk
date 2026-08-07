import type { Signal } from '@/lib/ticker/types';

function VoteTag({ vote }: { vote: Signal['vote'] }) {
  const bullish = vote === 'bullish';
  return (
    <span
      className={`inline-block whitespace-nowrap border px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.12em] ${
        bullish
          ? 'border-bull/50 bg-bull/10 text-bull'
          : 'border-bear/50 bg-bear/10 text-bear'
      }`}
    >
      {bullish ? 'Bullish' : 'Bearish'}
    </span>
  );
}

export function SignalTable({ signals }: { signals: Signal[] }) {
  return (
    <section aria-label="Individual signals" className="panel">
      <div className="flex items-baseline justify-between border-b border-term-line px-3.5 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
          Signals
        </h2>
        <span className="text-2xs text-term-faint">
          each votes one way — there is no neutral
        </span>
      </div>

      <ol className="divide-y divide-term-line/70">
        {signals.map((signal, i) => (
          <li
            key={signal.id}
            className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3.5 py-3"
          >
            <span className="w-5 shrink-0 pt-0.5 text-2xs tabular-nums text-term-faint">
              {String(i + 1).padStart(2, '0')}
            </span>

            <div className="min-w-[9rem] shrink-0">
              <div className="text-xs font-bold text-term-text">{signal.name}</div>
              <div className="mt-0.5 text-2xs tabular-nums text-term-faint">
                {signal.detail}
              </div>
            </div>

            <p className="min-w-[14rem] flex-1 text-xs leading-relaxed text-term-dim">
              {signal.reason}
            </p>

            <div className="ml-auto shrink-0">
              <VoteTag vote={signal.vote} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
