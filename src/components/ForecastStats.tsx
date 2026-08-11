import { InfoTip } from './InfoTip';
import { formatPrice, formatUsd } from '@/lib/format';
import type { ForecastResult } from '@/lib/forecast/types';
import type { TooltipKey } from '@/lib/tooltips';

function Tile({
  label,
  value,
  sub,
  tone = 'neutral',
  tip,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'bull' | 'bear' | 'flip' | 'pos' | 'neg';
  tip: TooltipKey;
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
      <div className="flex items-center gap-1.5">
        <span className="label-xs">{label}</span>
        <InfoTip for={tip} />
      </div>
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
          tip="odds"
        />
      ))}

      <Tile
        label={`Down ${data.crashThresholdPct.toFixed(0)}%+`}
        value={`${data.crashPct.toFixed(1)}%`}
        sub={`of ${data.paths.toLocaleString('en-US')} paths, any point`}
        tone={data.crashPct >= 5 ? 'bear' : 'neutral'}
        tip="crash"
      />

      <Tile
        label="Gamma regime"
        value={
          data.regime === null ? '—' : data.regime === 'positive' ? 'POSITIVE' : 'NEGATIVE'
        }
        sub={
          data.regime === null
            ? 'no listed options'
            : formatUsd(data.netGex ?? 0)
        }
        tone={data.regime === null ? 'neutral' : data.regime === 'positive' ? 'pos' : 'neg'}
        tip="regime"
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
        tip="realisedVol"
      />
    </section>
  );
}
