import type { MarketInternals as Internals } from '@/lib/groups/types';

function Gauge({
  label,
  pct,
  count,
  universe,
  tone,
}: {
  label: string;
  pct: number;
  count: number;
  universe: number;
  tone: 'bull' | 'bear';
}) {
  const bar = tone === 'bull' ? 'bg-bull' : 'bg-bear';
  const text = tone === 'bull' ? 'text-bull' : 'text-bear';

  return (
    <div className="panel px-3.5 py-2.5">
      <div className="label-xs">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${text}`}>
        {pct.toFixed(0)}%
      </div>
      <div className="mt-1.5 h-1 w-full bg-term-line">
        <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct).toFixed(2)}%` }} />
      </div>
      <div className="mt-1 text-2xs text-term-faint">
        {count} of {universe}
      </div>
    </div>
  );
}

export function MarketInternalsStrip({ internals }: { internals: Internals }) {
  const { universe } = internals;

  return (
    <section aria-label="Market internals" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
          Market internals
        </h2>
        <p className="text-2xs text-term-faint">
          breadth across the {universe} tracked names — this is what feeds the
          forecast&rsquo;s breadth input
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Gauge
          label="Above 20-day MA"
          pct={internals.above20Pct}
          count={internals.above20}
          universe={universe}
          tone="bull"
        />
        <Gauge
          label="Above 50-day MA"
          pct={internals.above50Pct}
          count={internals.above50}
          universe={universe}
          tone="bull"
        />
        <Gauge
          label="At 4-week highs"
          pct={internals.at4wHighPct}
          count={internals.at4wHigh}
          universe={universe}
          tone="bull"
        />
        <Gauge
          label="At 4-week lows"
          pct={internals.at4wLowPct}
          count={internals.at4wLow}
          universe={universe}
          tone="bear"
        />
      </div>
    </section>
  );
}
