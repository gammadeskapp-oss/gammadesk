import { InfoTip } from '@/components/InfoTip';
import type { FactorDirection, MacroBias, MacroFactor } from '@/lib/macroBias/types';

/**
 * The Macro Bias box in the home-page context row.
 *
 * Same shape as the Market box beside it — four metrics across, each a small
 * uppercase label, a big light value and a small coloured sub-line — so the two
 * read as one row. Reads a stored record only; nothing here calls FRED.
 *
 * Colour follows the factor's direction, not its raw number: green when it
 * favours stocks, red when it works against them, amber when it is neutral or
 * sticky. The Bias value itself takes the summed direction.
 */

/** Sub-line colour by direction. Amber (flip) is the warning/neutral tone. */
function subTone(direction: FactorDirection): string {
  if (direction === 'bullish') return 'text-bull';
  if (direction === 'bearish') return 'text-bear';
  return 'text-flip';
}

/** The big value: coloured for the Bias headline, light for the raw metrics. */
function valueTone(direction: FactorDirection, headline: boolean): string {
  if (!headline) return 'text-term-text';
  if (direction === 'bullish') return 'text-bull';
  if (direction === 'bearish') return 'text-bear';
  return 'text-term-text';
}

function Metric({
  label,
  factor,
  headline = false,
}: {
  label: string;
  factor: MacroFactor;
  headline?: boolean;
}) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-[0.14em] text-term-faint">{label}</dt>
      <dd className={`mt-0.5 text-base font-bold tabular-nums ${valueTone(factor.direction, headline)}`}>
        {factor.value}
      </dd>
      <dd className={`text-2xs ${subTone(factor.direction)}`}>{factor.sub}</dd>
    </div>
  );
}

export function MacroBiasCard({ bias }: { bias: MacroBias }) {
  // The Bias headline reuses the MacroFactor shape so the tile is uniform.
  const biasMetric: MacroFactor = {
    value: `${bias.score >= 0 ? '+' : ''}${bias.score}`,
    sub: bias.label,
    score: 0,
    direction: bias.direction,
  };

  return (
    <div className="panel px-3.5 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="label-xs">Macro Bias</span>
        <InfoTip for="macroBias" />
      </div>

      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Metric label="Bias" factor={biasMetric} headline />
        <Metric label="Fed" factor={bias.fed} />
        <Metric label="10Y" factor={bias.tenYear} />
        <Metric label="CPI" factor={bias.cpi} />
      </dl>

      <p className="mt-2 border-t border-term-line pt-2 text-2xs leading-relaxed text-term-dim">
        {bias.footer}
      </p>
    </div>
  );
}
