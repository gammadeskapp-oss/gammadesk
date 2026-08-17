'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DataQuality } from './DataQuality';
import { DealerConventionNote } from './DealerConventionNote';
import { ExplainPanel } from './ExplainPanel';
import { PageBar } from './PageBar';
import { PositioningSearch } from './PositioningSearch';
import { PositioningTable } from './PositioningTable';
import { ReadMode, useReadMode } from './ReadMode';
import { nearestStrongWall } from '@/lib/simple/walls';
import { SimpleRead } from './SimpleRead';
import { SummaryStrip } from './SummaryStrip';
import { TabBar } from './TabBar';
import type { MetricKey, PositioningData } from '@/lib/types';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

interface DashboardProps {
  data: PositioningData;
}

/** `24m 10s` style countdown to the next server-side data refresh. */
function CacheCountdown({ asOfIso, cacheSeconds }: { asOfIso: string; cacheSeconds: number }) {
  // Rendered only after mount: the server and the browser would otherwise
  // compute different remaining times and trip a hydration mismatch.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const expiry = new Date(asOfIso).getTime() + cacheSeconds * 1000;
    const tick = () =>
      setRemaining(Math.max(0, Math.round((expiry - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [asOfIso, cacheSeconds]);

  if (remaining === null) return null;

  if (remaining === 0) {
    return <span className="text-term-dim">ready to refresh</span>;
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <span className="tabular-nums text-term-dim">
      next fetch in {minutes}m {String(seconds).padStart(2, '0')}s
    </span>
  );
}

export function Dashboard({ data }: DashboardProps) {
  const [metric, setMetric] = useState<MetricKey>('gex');
  const [explain, setExplain] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const mode = useReadMode();

  const strikeGex = data.rows.map((r) => ({ strike: r.strike, gex: r.total.gex }));

  const reload = () => startTransition(() => router.refresh());

  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      <PageBar
        title={mode === 'simple' ? `${data.symbol} Today` : `${data.symbol} Dealer Positioning`}
        description={PAGE_DESCRIPTIONS['/']}
        asOfLabel={data.meta.asOfLabel}
      />

      <PositioningSearch initial={data.symbol} />

      {/*
        Above the read, and outside the mode toggle, because it qualifies both
        views equally — the simple wording is if anything the easier one to
        take at face value.
      */}
      <DealerConventionNote symbol={data.symbol} />

      {/*
        Simple leads. The exposure tables are the same data one tap away, and
        the toggle remembers which side the reader chose.
      */}
      <ReadMode
        simple={
          <SimpleRead
            input={{
              symbol: data.symbol,
              regime: data.summary.regime,
              flipLevel: data.summary.flipLevel,
              aboveFlip:
                data.summary.flipLevel === null
                  ? null
                  : data.summary.spot > data.summary.flipLevel,
              // Same helper /decision uses, so both pages name the same
              // level — the summary's magnet is the *biggest* wall, which
              // can sit far above the one price actually runs into first.
              magnetAbove: nearestStrongWall(strikeGex, data.summary.spot, 'above')?.strike ?? null,
              magnetBelow: nearestStrongWall(strikeGex, data.summary.spot, 'below')?.strike ?? null,
            }}
          />
        }
        advanced={<Advanced />}
      />
    </main>
  );

  function Advanced() {
    return (
      <div className="space-y-4">
      <SummaryStrip summary={data.summary} symbol={data.symbol} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar active={metric} onChange={setMetric} />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setExplain((v) => !v)}
            aria-expanded={explain}
            aria-controls="explain-panel"
            className={`border px-3.5 py-2 text-xs tracking-[0.08em] transition-colors ${
              explain
                ? 'border-pos/60 bg-pos/12 text-pos'
                : 'border-term-line bg-term-panel/60 text-term-dim hover:border-term-edge hover:text-term-text'
            }`}
          >
            {explain ? '▾' : '▸'} What am I looking at?
          </button>

          <div className="flex items-center gap-2.5 text-2xs">
            <CacheCountdown
              asOfIso={data.meta.asOfIso}
              cacheSeconds={data.meta.cacheSeconds}
            />
            <button
              type="button"
              onClick={reload}
              disabled={pending}
              title={`Data is cached for ${Math.round(data.meta.cacheSeconds / 60)} minutes to stay inside the Polygon free-plan limit of 5 requests per minute. Reloading before then re-reads the cached snapshot.`}
              className="border border-term-line bg-term-panel/60 px-3 py-2 uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text disabled:opacity-40"
            >
              {pending ? 'Loading…' : 'Reload'}
            </button>
          </div>
        </div>
      </div>

      {explain && (
        <div id="explain-panel">
          <ExplainPanel metric={metric} />
        </div>
      )}

      <div
        id="positioning-panel"
        role="tabpanel"
        aria-labelledby={`tab-${metric}`}
      >
        <PositioningTable data={data} metric={metric} />
      </div>

      <DataQuality meta={data.meta} contracts={data.meta.contractsUsed} />
      </div>
    );
  }
}
