import { formatPrice, formatRatio, formatStrike, formatUsd } from '@/lib/format';
import type { Summary } from '@/lib/types';

interface TileProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'flip';
  title?: string;
}

const TONE_VALUE: Record<NonNullable<TileProps['tone']>, string> = {
  neutral: 'text-term-text',
  pos: 'text-pos',
  neg: 'text-neg',
  flip: 'text-flip',
};

const TONE_EDGE: Record<NonNullable<TileProps['tone']>, string> = {
  neutral: 'border-term-line',
  pos: 'border-pos/40',
  neg: 'border-neg/40',
  flip: 'border-flip/40',
};

function Tile({ label, value, sub, tone = 'neutral', title }: TileProps) {
  return (
    <div
      title={title}
      className={`panel border-l-2 px-3.5 py-2.5 ${TONE_EDGE[tone]}`}
    >
      <div className="label-xs">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${TONE_VALUE[tone]}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-2xs text-term-faint">{sub}</div>}
    </div>
  );
}

interface SummaryStripProps {
  summary: Summary;
  symbol: string;
}

export function SummaryStrip({ summary, symbol }: SummaryStripProps) {
  const {
    spot,
    netGex,
    regime,
    flipLevel,
    magnetAbove,
    magnetBelow,
    putCallOiRatio,
  } = summary;

  const flipDistance =
    flipLevel === null ? null : ((spot - flipLevel) / flipLevel) * 100;

  return (
    <section
      aria-label="Positioning summary"
      className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6"
    >
      <Tile
        label={`${symbol} spot`}
        value={formatPrice(spot)}
        sub={`put/call OI ${formatRatio(putCallOiRatio)}`}
        title="Underlying price the greeks were calculated at."
      />

      <Tile
        label="Net GEX"
        value={formatUsd(netGex)}
        sub="$ delta per +1% move"
        tone={netGex >= 0 ? 'pos' : 'neg'}
        title="Total dealer gamma exposure across every strike and expiration shown."
      />

      <Tile
        label="Gamma regime"
        value={regime === 'positive' ? 'POSITIVE' : 'NEGATIVE'}
        sub={
          regime === 'positive'
            ? 'dealers dampen moves'
            : 'dealers amplify moves'
        }
        tone={regime === 'positive' ? 'pos' : 'neg'}
        title={
          regime === 'positive'
            ? 'Dealer hedging leans against price moves: expect chop and mean reversion.'
            : 'Dealer hedging leans with price moves: expect trends and higher volatility.'
        }
      />

      <Tile
        label="Gamma flip"
        value={flipLevel === null ? '—' : formatPrice(flipLevel)}
        sub={
          flipDistance === null
            ? 'no crossing within ±15%'
            : `spot is ${flipDistance >= 0 ? '+' : ''}${flipDistance.toFixed(2)}% vs flip`
        }
        tone="flip"
        title="Price level at which aggregate dealer gamma changes sign."
      />

      <Tile
        label="Magnet above"
        value={magnetAbove ? formatStrike(magnetAbove.strike) : '—'}
        sub={magnetAbove ? formatUsd(magnetAbove.gex) : 'none'}
        tone={
          magnetAbove ? (magnetAbove.gex >= 0 ? 'pos' : 'neg') : 'neutral'
        }
        title="Strike above spot carrying the largest absolute gamma exposure."
      />

      <Tile
        label="Magnet below"
        value={magnetBelow ? formatStrike(magnetBelow.strike) : '—'}
        sub={magnetBelow ? formatUsd(magnetBelow.gex) : 'none'}
        tone={
          magnetBelow ? (magnetBelow.gex >= 0 ? 'pos' : 'neg') : 'neutral'
        }
        title="Strike at or below spot carrying the largest absolute gamma exposure."
      />
    </section>
  );
}
