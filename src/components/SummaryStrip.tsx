import { regimeLabel, regimeSubLine, regimeTone } from '@/lib/regime';
import { InfoTip } from './InfoTip';
import { formatPrice, formatRatio, formatStrike, formatUsd } from '@/lib/format';
import type { TooltipKey } from '@/lib/tooltips';
import type { Summary } from '@/lib/types';

interface TileProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'flip';
  /** Plain-language explanation, opened by the `?` beside the label. */
  tip: TooltipKey;
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

function Tile({ label, value, sub, tone = 'neutral', tip }: TileProps) {
  return (
    <div className={`panel border-l-2 px-3.5 py-2.5 ${TONE_EDGE[tone]}`}>
      <div className="flex items-center gap-1.5">
        <span className="label-xs">{label}</span>
        <InfoTip for={tip} />
      </div>
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
        tip="spot"
      />

      <Tile
        label="Net GEX"
        value={formatUsd(netGex)}
        sub="$ delta per +1% move"
        tone={netGex >= 0 ? 'pos' : 'neg'}
        tip="netGex"
      />

      <Tile
        label="Gamma regime"
        value={regimeLabel(regime)}
        sub={regimeSubLine(regime)}
        tone={regimeTone(regime)}
        tip="regime"
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
        tip="flip"
      />

      <Tile
        label="Magnet above"
        value={magnetAbove ? formatStrike(magnetAbove.strike) : '—'}
        sub={magnetAbove ? formatUsd(magnetAbove.gex) : 'none'}
        tone={
          magnetAbove ? (magnetAbove.gex >= 0 ? 'pos' : 'neg') : 'neutral'
        }
        tip="magnetAbove"
      />

      <Tile
        label="Magnet below"
        value={magnetBelow ? formatStrike(magnetBelow.strike) : '—'}
        sub={magnetBelow ? formatUsd(magnetBelow.gex) : 'none'}
        tone={
          magnetBelow ? (magnetBelow.gex >= 0 ? 'pos' : 'neg') : 'neutral'
        }
        tip="magnetBelow"
      />
    </section>
  );
}
