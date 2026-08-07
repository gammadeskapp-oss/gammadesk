import { formatPrice, formatUsd } from '@/lib/format';
import type { ForecastResult } from '@/lib/forecast/types';

function Tile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'bull' | 'bear' | 'flip' | 'pos' | 'neg';
}) {
  const colour = {
    neutral: 'text-term-text',
    bull: 'text-bull',
    bear: 'text-bear',
    flip: 'text-flip',
    pos: 'text-pos',
    neg: 'text-neg',
  }[tone];
  const edge = {
    neutral: 'border-term-line',
    bull: 'border-bull/40',
    bear: 'border-bear/40',
    flip: 'border-flip/40',
    pos: 'border-pos/40',
    neg: 'border-neg/40',
  }[tone];

  return (
    <div className={`panel border-l-2 px-3.5 py-2.5 ${edge}`}>
      <div className="label-xs">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${colour}`}>{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-term-faint">{sub}</div>}
    </div>
  );
}

export function ForecastStats({ data }: { data: ForecastResult }) {
  return (
    <section
      aria-label="Simulation summary"
      className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6"
    >
      {data.odds.map((o) => (
        <Tile
          key={o.day}
          label={`${o.label} higher`}
          value={`${o.higherPct.toFixed(0)}%`}
          sub={`median ${formatPrice(o.medianPrice)}`}
          tone={o.higherPct >= 50 ? 'bull' : 'bear'}
        />
      ))}

      <Tile
        label={`Down ${data.crashThresholdPct.toFixed(0)}%+`}
        value={`${data.crashPct.toFixed(1)}%`}
        sub={`of ${data.paths.toLocaleString('en-US')} paths, any point`}
        tone={data.crashPct >= 5 ? 'bear' : 'neutral'}
      />

      <Tile
        label="Gamma regime"
        value={data.regime === 'positive' ? 'POSITIVE' : 'NEGATIVE'}
        sub={formatUsd(data.netGex)}
        tone={data.regime === 'positive' ? 'pos' : 'neg'}
      />

      <Tile
        label="Realised vol"
        value={`${(data.volatility * 100).toFixed(1)}%`}
        sub={
          data.gammaFlip === null
            ? '20-day, annualised'
            : `flip ${formatPrice(data.gammaFlip)}`
        }
        tone="flip"
      />
    </section>
  );
}
