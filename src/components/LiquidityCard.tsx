import { formatContracts, formatUsd } from '@/lib/format';
import type { Liquidity } from '@/lib/ticker/types';

const TONE: Record<Liquidity['label'], { text: string; edge: string; blurb: string }> = {
  HIGH: {
    text: 'text-bull',
    edge: 'border-l-bull/60',
    blurb: 'Easy to get in and out of at size without moving the price.',
  },
  MEDIUM: {
    text: 'text-flip',
    edge: 'border-l-flip/60',
    blurb: 'Tradable, but large orders will start to show up in the price.',
  },
  LOW: {
    text: 'text-bear',
    edge: 'border-l-bear/60',
    blurb: 'Thin. Spreads will be wide and exits can be expensive under stress.',
  },
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-2xs text-term-faint">{label}</span>
      <span className="text-xs tabular-nums text-term-dim">{value}</span>
    </div>
  );
}

export function LiquidityCard({ liquidity }: { liquidity: Liquidity }) {
  const tone = TONE[liquidity.label];

  return (
    <section
      aria-label="Liquidity"
      className={`panel border-l-2 ${tone.edge} p-4`}
    >
      <div className="label-xs">Liquidity</div>
      <div className={`mt-1 text-2xl font-bold tracking-[0.14em] ${tone.text}`}>
        {liquidity.label}
      </div>
      <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">{tone.blurb}</p>

      <div className="mt-3 border-t border-term-line pt-2">
        <Row
          label="avg daily $ volume"
          value={formatUsd(liquidity.avgDollarVolume)}
        />
        <Row
          label="avg daily shares"
          value={formatContracts(liquidity.avgShareVolume)}
        />
        <Row
          label="options volume"
          value={
            liquidity.optionsVolume === null
              ? 'none listed'
              : formatContracts(liquidity.optionsVolume)
          }
        />
        <Row
          label="options open interest"
          value={
            liquidity.optionsOpenInterest === null
              ? '—'
              : formatContracts(liquidity.optionsOpenInterest)
          }
        />
      </div>

      {liquidity.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-term-line pt-2 text-2xs text-flip/80">
          {liquidity.notes.map((note) => (
            <li key={note}>! {note}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-term-line pt-2 text-2xs text-term-faint">
        Based on the last 20 sessions. Options figures come from the listed
        chain and are delayed.
      </p>
    </section>
  );
}
