import { formatPrice } from '@/lib/format';
import { riskLabel, type RiskLabel } from '@/lib/forecast/risk';
import type { ForecastResult } from '@/lib/forecast/types';

const TONE: Record<RiskLabel, { text: string; edge: string; blurb: string }> = {
  CALM: {
    text: 'text-bull',
    edge: 'border-l-bull/60',
    blurb:
      'A deep drawdown is a tail case in the current simulation. Ordinary conditions.',
  },
  CAUTIOUS: {
    text: 'text-flip',
    edge: 'border-l-flip/60',
    blurb:
      'The left tail is thickening. Worth sizing positions with the downside in mind.',
  },
  DEFENSIVE: {
    text: 'text-bear',
    edge: 'border-l-bear/60',
    blurb:
      'A large drawdown is a live scenario in a meaningful share of paths, not an outlier.',
  },
};

export function CrashCard({ forecast }: { forecast: ForecastResult }) {
  const label = riskLabel(forecast.crashPct);
  const tone = TONE[label];
  const worst = forecast.bands[forecast.bands.length - 1];

  return (
    <section
      aria-label="Downturn risk"
      className={`panel border-l-2 ${tone.edge} p-4`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <div className="label-xs">
            {forecast.symbol} · {forecast.horizon}-day downturn probability
          </div>
          <div className={`mt-1 text-3xl font-bold tabular-nums leading-none ${tone.text}`}>
            {forecast.crashPct.toFixed(1)}%
          </div>
          <p className="mt-1.5 text-2xs text-term-faint">
            of {forecast.paths.toLocaleString('en-US')} simulated paths close{' '}
            {forecast.crashThresholdPct.toFixed(0)}% or more below{' '}
            {formatPrice(forecast.spot)} at some point
          </p>
        </div>

        <div className="text-right">
          <div className={`text-xl font-bold tracking-[0.18em] ${tone.text}`}>
            {label}
          </div>
          <p className="mt-1 max-w-[16rem] text-2xs leading-relaxed text-term-faint">
            {tone.blurb}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-term-line pt-2.5 text-2xs sm:grid-cols-4">
        <div>
          <span className="text-term-faint">realised vol </span>
          <span className="text-term-dim">{(forecast.volatility * 100).toFixed(1)}%</span>
        </div>
        <div>
          <span className="text-term-faint">regime </span>
          <span
            className={
              forecast.regime === null
                ? 'text-term-faint'
                : forecast.regime === 'positive'
                  ? 'text-pos'
                  : 'text-neg'
            }
          >
            {forecast.regime === null
              ? 'n/a'
              : forecast.regime === 'positive'
                ? 'POSITIVE'
                : 'NEGATIVE'}
          </span>
        </div>
        <div>
          <span className="text-term-faint">20d p2.5 </span>
          <span className="text-term-dim">{formatPrice(worst?.p2_5 ?? forecast.spot)}</span>
        </div>
        <div>
          <span className="text-term-faint">20d median </span>
          <span className="text-term-dim">{formatPrice(worst?.p50 ?? forecast.spot)}</span>
        </div>
      </div>

      <p className="mt-2.5 border-t border-term-line pt-2 text-2xs leading-relaxed text-flip/80">
        This is an <strong>underestimate</strong>. The simulation holds
        volatility fixed and assumes log-normal returns, and real crashes arrive
        with volatility exploding and fatter tails than that allows. Read it as
        a floor on the risk, never a ceiling.
      </p>
    </section>
  );
}
