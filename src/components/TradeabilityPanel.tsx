import { InfoTip } from '@/components/InfoTip';
import { formatContracts, formatUsd } from '@/lib/format';
import type { Tooltip } from '@/lib/tooltips';
import type {
  EquityLiquidity,
  Liquidity,
  LiquidityLabel,
  OptionsLiquidity,
  TierCutoffs,
} from '@/lib/ticker/types';

/**
 * Tradeability — can this one name be dealt in, and is its chain deep enough
 * to trust the exposure maths?
 *
 * Deliberately NOT called "liquidity" on screen. The dashboard carries a US
 * net liquidity tile, which is a macro measure of money in the system and has
 * nothing to do with this; two panels both labelled "liquidity" would read as
 * two views of one thing.
 *
 * Stock and options are shown as separate blocks with separate verdicts,
 * because they fail independently and the interesting case is exactly the one
 * a blended score hides.
 */

const TONE: Record<LiquidityLabel, { text: string; edge: string }> = {
  HIGH: { text: 'text-bull', edge: 'border-l-bull/60' },
  MEDIUM: { text: 'text-flip', edge: 'border-l-flip/60' },
  LOW: { text: 'text-bear', edge: 'border-l-bear/60' },
};

/** Spreads run from ~0.005% on SPY to double digits on a dead contract. */
function formatPct(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  const pct = fraction * 100;
  if (pct < 0.01) return `${pct.toFixed(3)}%`;
  if (pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

function Row({
  label,
  value,
  tip,
  muted = false,
}: {
  label: string;
  value: string;
  tip?: Tooltip;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="flex items-center gap-1.5">
        <span className="text-2xs text-term-faint">{label}</span>
        {tip && <InfoTip tip={tip} />}
      </span>
      <span
        className={`text-xs tabular-nums ${muted ? 'text-term-faint' : 'text-term-dim'}`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The tier word, with the cutoffs that produced it one tap away.
 *
 * The bubble is built from the same config values the assessment used, so it
 * cannot drift out of step with the label it explains.
 */
function Tier({
  tier,
  basis,
  cutoffs,
  unit,
  format,
}: {
  tier: LiquidityLabel | null;
  basis: string;
  cutoffs: TierCutoffs;
  unit: string;
  format: (v: number) => string;
}) {
  if (tier === null) {
    return <span className="text-lg font-bold tracking-[0.14em] text-term-faint">—</span>;
  }

  const tip: Tooltip = {
    label: `${tier} — how this is decided`,
    plain: `Measured on ${basis}. HIGH is ${format(cutoffs.high)} ${unit} or more. MEDIUM is ${format(cutoffs.medium)} to ${format(cutoffs.high)}. LOW is anything under ${format(cutoffs.medium)}.`,
    detail:
      'These cutoffs are conventions chosen for this site, not measured edges. They are set in config and stated here so you can disagree with where the lines fall.',
  };

  return (
    <span className="flex items-center gap-1.5">
      <span className={`text-lg font-bold tracking-[0.14em] ${TONE[tier].text}`}>
        {tier}
      </span>
      <InfoTip tip={tip} />
    </span>
  );
}

function Block({
  title,
  question,
  tone,
  children,
  verdict,
}: {
  title: string;
  question: string;
  tone: LiquidityLabel | null;
  verdict: React.ReactNode;
  children: React.ReactNode;
}) {
  const edge = tone === null ? 'border-l-term-line' : TONE[tone].edge;
  return (
    <div className={`border border-term-line border-l-2 ${edge} px-3 py-2.5`}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="label-xs">{title}</h4>
        {verdict}
      </div>
      <p className="mt-0.5 text-2xs leading-relaxed text-term-faint">{question}</p>
      <div className="mt-2 border-t border-term-line pt-1.5">{children}</div>
    </div>
  );
}

function Equity({ equity }: { equity: EquityLiquidity }) {
  return (
    <Block
      title="Stock"
      question="Can I get in and out of the shares?"
      tone={equity.tier}
      verdict={
        <Tier
          tier={equity.tier}
          basis={`average daily dollar volume over the last ${equity.sessions} sessions`}
          cutoffs={equity.cutoffs}
          unit="a day"
          format={formatUsd}
        />
      }
    >
      <Row label="avg daily $ volume" value={formatUsd(equity.avgDollarVolume)} />
      <Row label="avg daily shares" value={formatContracts(equity.avgShareVolume)} />
      <Row
        label="quoted spread"
        value={formatPct(equity.spreadPct)}
        muted={equity.spreadPct === null}
        tip={{
          label: 'Quoted spread',
          plain:
            'The gap between the best buy and best sell price, as a percentage of the price in between. It is roughly what a round trip costs you before anything moves.',
          detail:
            'Bid-ask spread over the mid, from the underlying quote on the options feed. Shown only when both sides are actually being quoted — outside market hours it reads as unavailable rather than being estimated from volume or daily range, which measure something else.',
        }}
      />
    </Block>
  );
}

function Options({ options }: { options: OptionsLiquidity }) {
  if (!options.listed) {
    return (
      <Block
        title="Options"
        question="Are the contracts tradeable, and is the exposure maths reliable?"
        tone={null}
        verdict={
          <span className="text-2xs font-bold uppercase tracking-[0.14em] text-term-faint">
            unavailable
          </span>
        }
      >
        <p className="py-2 text-2xs leading-relaxed text-term-dim">
          No listed options chain came back for this symbol. Nothing is
          substituted for it, and every exposure figure on this page is
          suppressed.
        </p>
      </Block>
    );
  }

  return (
    <Block
      title="Options"
      question="Are the contracts tradeable, and is the exposure maths reliable?"
      tone={options.tier}
      verdict={
        <Tier
          tier={options.tier}
          basis="the weaker of chain volume and open interest"
          cutoffs={options.volumeCutoffs}
          unit="contracts traded a day"
          format={formatContracts}
        />
      }
    >
      <Row label="chain volume" value={formatContracts(options.volume ?? 0)} />
      <Row
        label="open interest"
        value={formatContracts(options.openInterest ?? 0)}
        tip={{
          label: 'Open interest',
          plain:
            'How many contracts are currently held open across the whole chain. It is the base every exposure number here is built on.',
          detail: `Below ${options.minOpenInterestForExposure.toLocaleString('en-US')} contracts the GEX, VEX and CEX figures are suppressed on this page rather than shown, because open interest that small multiplied by a modelled greek is arithmetic on noise.`,
        }}
      />
      <Row
        label="near-money option spread"
        value={
          options.spreadPct === null
            ? 'too few tradeable contracts to measure'
            : formatPct(options.spreadPct)
        }
        muted={options.spreadPct === null}
        tip={{
          label: 'Near-money option spread',
          plain:
            "The typical bid-ask gap on the contracts a person would actually trade — near the current price, in the nearest monthly expiries — as a percentage of the option's own price. Wide here means entering and exiting the option costs real money.",
          detail: `Open-interest-weighted across the ${options.spreadSample.toLocaleString('en-US')} two-sided contracts within ${options.spreadStrikesEachSide} strikes either side of spot in the nearest ${options.spreadExpiries} monthly expiries. Restricted that way because the rest of a chain is far-dated, far-out-of-the-money strikes quoted a dollar wide on a five-cent option — averaging those in described a book nobody trades. Under ${options.minSpreadStrikes} surviving strikes nothing is reported rather than a figure from a thin sample.`,
        }}
      />

      {!options.exposureReliable && (
        <p className="mt-2 border-t border-term-line pt-2 text-2xs leading-relaxed text-flip">
          Not enough options liquidity to compute exposure reliably.
        </p>
      )}
    </Block>
  );
}

export function TradeabilityPanel({ liquidity }: { liquidity: Liquidity }) {
  return (
    <div className="panel space-y-2 p-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Equity equity={liquidity.equity} />
        <Options options={liquidity.options} />
      </div>

      {liquidity.notes.length > 0 && (
        <ul className="space-y-1 px-1 text-2xs leading-relaxed text-flip/80">
          {liquidity.notes.map((note) => (
            <li key={note}>! {note}</li>
          ))}
        </ul>
      )}

      <p className="px-1 pb-1 text-2xs leading-relaxed text-term-faint">
        Share figures are averaged over the last {liquidity.equity.sessions}{' '}
        sessions of daily bars. Options figures and both spreads come from the
        listed chain and are delayed
        {liquidity.asOfLabel ? `, quoted ${liquidity.asOfLabel}` : ''}. The
        option spread covers only the{' '}
        {liquidity.options.spreadStrikesEachSide} strikes above and below the
        current price in the nearest {liquidity.options.spreadExpiries} monthly
        expiries, weighted by
        open interest, so it reflects the contracts people actually trade
        rather than the whole chain. A name
        can rate highly on one block and poorly on the other — that gap is the
        reason they are shown apart.
      </p>
    </div>
  );
}
