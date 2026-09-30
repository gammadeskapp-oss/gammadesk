import { PreviewCard } from './PreviewCard';
import { MacroAlignmentBadge } from './MacroAlignmentBadge';
import { TickerLink } from '@/components/TickerLink';
import { formatPrice } from '@/lib/format';
import type {
  ForwardOutlookMock,
  LeadershipMock,
  MarketHealthMock,
  NetLiquidityMock,
  OptionsFlowMock,
  ScannerShortlistMock,
  TrackRecordMock,
} from '@/lib/redesign/mock';

/** A small stat: big value + faint label. */
function Stat({ value, label, tone = 'text-term-text' }: { value: string; label: string; tone?: string }) {
  return (
    <div>
      <div className={`text-xl font-bold tabular-nums leading-none ${tone}`}>{value}</div>
      <div className="mt-1 text-2xs text-term-faint">{label}</div>
    </div>
  );
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

// --- Market health -----------------------------------------------------------

export function MarketHealthPreview({ data }: { data: MarketHealthMock }) {
  return (
    <PreviewCard title="Market health" href="/dashboard" tone="neutral">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Stat value={`${data.breadthPct}%`} label="above prior close" />
        <Stat
          value={data.vix.value.toFixed(1)}
          label={`VIX · ${pct(data.vix.changePct)}`}
          tone={data.vix.changePct <= 0 ? 'text-bull' : 'text-bear'}
        />
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        {data.indices.map((i) => (
          <li key={i.symbol} className="flex items-baseline justify-between gap-3 tabular-nums">
            <span className="font-bold text-term-text">{i.symbol}</span>
            <span className="text-term-faint">{formatPrice(i.last)}</span>
            <span className={`w-16 text-right font-bold ${i.changePct >= 0 ? 'text-bull' : 'text-bear'}`}>
              {pct(i.changePct)}
            </span>
          </li>
        ))}
      </ul>
    </PreviewCard>
  );
}

// --- Forward outlook ---------------------------------------------------------

export function ForwardOutlookPreview({ data }: { data: ForwardOutlookMock }) {
  const bullish = data.lean === 'higher';
  return (
    <PreviewCard title="Forward outlook" href="/forecast" tone={bullish ? 'bull' : 'bear'}>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Stat
          value={`${data.higherPct}%`}
          label={`lean ${data.lean} · ${data.horizonLabel}`}
          tone={bullish ? 'text-bull' : 'text-bear'}
        />
        <Stat
          value={`${data.downturnPct.toFixed(1)}%`}
          label={`downturn prob · ${data.downturnLabel}`}
          tone={data.downturnLabel === 'DEFENSIVE' ? 'text-bear' : data.downturnLabel === 'CAUTIOUS' ? 'text-flip' : 'text-bull'}
        />
      </div>
      <p className="mt-3 text-2xs leading-relaxed text-term-faint">
        A modelling lean, not a probability of the world — the downturn figure understates the tail.
      </p>
    </PreviewCard>
  );
}

// --- Net liquidity -----------------------------------------------------------

export function NetLiquidityPreview({ data }: { data: NetLiquidityMock }) {
  const points = data.trend;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 120;
  const h = 28;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <PreviewCard title="Net liquidity" href="/dashboard" tone="neutral">
      <div className="flex items-end justify-between gap-3">
        <Stat value={data.value} label={`weekly ${data.weeklyChange}`} tone={data.weeklyUp ? 'text-bull' : 'text-bear'} />
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className={data.weeklyUp ? 'text-bull' : 'text-bear'} />
        </svg>
      </div>
      <p className="mt-3 text-2xs leading-relaxed text-term-faint">
        Fed balance sheet less TGA and reverse repo — regime backdrop, not a signal.
      </p>
    </PreviewCard>
  );
}

// --- Leadership --------------------------------------------------------------

export function LeadershipPreview({ data }: { data: LeadershipMock }) {
  return (
    <PreviewCard title="Leadership" href="/strength" tone="bull" linksInside>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label-xs">Leaders</div>
          <ul className="mt-1 space-y-1 text-xs">
            {data.leaders.map((r) => (
              <li key={r.symbol} className="flex items-baseline justify-between gap-2 tabular-nums">
                <TickerLink symbol={r.symbol} className="font-bold text-term-text" />
                <span className="font-bold text-bull">{r.score}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="label-xs">Laggards</div>
          <ul className="mt-1 space-y-1 text-xs">
            {data.laggards.map((r) => (
              <li key={r.symbol} className="flex items-baseline justify-between gap-2 tabular-nums">
                <TickerLink symbol={r.symbol} className="font-bold text-term-text" />
                <span className="font-bold text-bear">{r.score}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-2xs text-term-faint">
        Sector lean: {data.sectors.map((s) => `${s.name} ${pct(s.changePct)}`).join(' · ')}
      </p>
    </PreviewCard>
  );
}

// --- Scanner shortlist + watchlist changes -----------------------------------

export function ScannerShortlistPreview({ data }: { data: ScannerShortlistMock }) {
  return (
    <PreviewCard title="Scanner shortlist" href="/scanner" tone="pos" linksInside>
      <ul className="space-y-1 text-xs">
        {data.shortlist.map((r) => (
          <li key={r.symbol} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <TickerLink symbol={r.symbol} className="font-bold text-term-text" />
              <MacroAlignmentBadge alignment={r.macro} />
            </span>
            <span className="font-bold tabular-nums text-pos">{r.score}</span>
          </li>
        ))}
      </ul>
      {data.watchlistChanges.length > 0 && (
        <div className="mt-3 border-t border-term-line pt-2">
          <div className="label-xs">Watchlist changes</div>
          <ul className="mt-1 space-y-0.5 text-2xs text-term-dim">
            {data.watchlistChanges.map((c) => (
              <li key={c.symbol}>
                <span className="font-bold text-term-text">{c.symbol}</span> {c.change}
              </li>
            ))}
          </ul>
        </div>
      )}
    </PreviewCard>
  );
}

// --- Options flow ------------------------------------------------------------

export function OptionsFlowPreview({ data }: { data: OptionsFlowMock }) {
  return (
    <PreviewCard title="Options flow" href="/flow" tone="neutral" linksInside>
      <ul className="space-y-1.5 text-xs">
        {data.highlights.map((h) => (
          <li key={`${h.symbol}-${h.note}`} className="flex items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-2">
              <TickerLink symbol={h.symbol} className="font-bold text-term-text" />
              <span className="text-term-dim">{h.note}</span>
            </span>
            <span className="tabular-nums text-term-faint">{h.ratio}</span>
          </li>
        ))}
      </ul>
    </PreviewCard>
  );
}

// --- Track record ------------------------------------------------------------

export function TrackRecordPreview({ data }: { data: TrackRecordMock }) {
  return (
    <PreviewCard title="Track record" href="/log" tone="neutral">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Stat value={`${data.hitRate}%`} label={`held · ${data.sample} calls`} tone="text-term-text" />
      </div>
      <p className="mt-3 text-2xs leading-relaxed text-term-faint">
        Last: {data.lastCall.date} — {data.lastCall.read} ·{' '}
        <span className={data.lastCall.outcome === 'held' ? 'text-bull' : 'text-bear'}>
          {data.lastCall.outcome}
        </span>
      </p>
    </PreviewCard>
  );
}
