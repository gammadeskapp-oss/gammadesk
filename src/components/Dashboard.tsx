'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DataQuality } from './DataQuality';
import { DealerConventionNote } from './DealerConventionNote';
import { ExplainPanel } from './ExplainPanel';
import { PageBar } from './PageBar';
import { PositioningSearch } from './PositioningSearch';
import { PositioningTable } from './PositioningTable';
import { ResearchCards } from './ResearchCards';
import { ReadMode, useReadMode } from './ReadMode';
import { nearestStrongWall } from '@/lib/simple/walls';
import { VerdictLead, WhatToWatch } from './SimpleRead';
import { MethodologyDrawer } from './MethodologyDrawer';
import { StaleDataBanner, mutedIf } from './StaleDataBanner';
import { SummaryStrip } from './SummaryStrip';
import { TabBar } from './TabBar';
import { WhatChanged } from './WhatChanged';
import type { Methodology } from '@/lib/methodology';
import type { Staleness } from '@/lib/staleness';
import type { MetricKey, PositioningData } from '@/lib/types';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

interface DashboardProps {
  data: PositioningData;
  /*
   * Graded on the server and passed down rather than computed here. This is a
   * client component, and "how old is this" depends on the current time — the
   * server and the browser would reach it a few hundred milliseconds apart and
   * could disagree about which side of the threshold the snapshot falls on,
   * which is a hydration mismatch on the one element that must never flicker.
   */
  staleness: Staleness;
  /*
   * Also built on the server. It is derived entirely from `data`, so it could
   * be computed here — but keeping both provenance props on the same side of
   * the boundary means there is one place to look when a drawer disagrees with
   * the numbers above it.
   */
  methodology: Methodology;
  /*
   * Rendered on the server and passed through as a node.
   *
   * The card inside it is `BreadthCard`, the same one /decision uses. Building
   * it here would mean this client component fetching breadth itself; handing
   * it down keeps every network read on the server page where the rest of them
   * already are.
   */
  contextRow: React.ReactNode;
  /**
   * The one research line that sits under the verdict — how carefully to read
   * today, never what to hold.
   *
   * Built on the server, in `lib/simple/research.ts`, because it needs the
   * breadth reading and this component is given only the option book.
   */
  researchLine: string;
  /**
   * What moved since the previous session, already built server-side. Empty
   * means nothing is rendered — see `WhatChanged` for why there is no empty
   * state.
   */
  whatChanged: string[];
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

export function Dashboard({
  data,
  staleness,
  methodology,
  contextRow,
  researchLine,
  whatChanged,
}: DashboardProps) {
  const [metric, setMetric] = useState<MetricKey>('gex');
  const [explain, setExplain] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const mode = useReadMode();

  const strikeGex = data.rows.map((r) => ({ strike: r.strike, gex: r.total.gex }));

  const reload = () => startTransition(() => router.refresh());

  /*
   * The one input both halves of the plain-English read are built from. Shared
   * rather than written out twice, so the verdict at the top of the page and
   * the "what to watch" note further down can never describe different books.
   */
  const simpleInput = {
    symbol: data.symbol,
    regime: data.summary.regime,
    flipLevel: data.summary.flipLevel,
    aboveFlip:
      data.summary.flipLevel === null
        ? null
        : data.summary.spot > data.summary.flipLevel,
    // Same helper /decision uses, so both pages name the same level — the
    // summary's magnet is the *biggest* wall, which can sit far above the one
    // price actually runs into first.
    magnetAbove: nearestStrongWall(strikeGex, data.summary.spot, 'above')?.strike ?? null,
    magnetBelow: nearestStrongWall(strikeGex, data.summary.spot, 'below')?.strike ?? null,
  } as const;

  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      {/* Above everything, full width, before the reader meets a single number. */}
      <StaleDataBanner staleness={staleness} />

      {/*
        ## Why the verdict is first, and the page title is not

        This block used to sit fifth, under a title, a jargon subtitle, a
        search box and two backdrop cards. On a 390px phone that put the one
        sentence the whole app exists to say below the fold — a first-time
        reader scrolled past a wall of chrome to reach the answer, or more
        often did not reach it at all.

        So the order is now: the verdict, the levels it refers to, and one line
        on how carefully to read today. Everything that qualifies that read —
        the title, the timestamp, the ticker box, breadth, the quotes and the
        event row — follows it, in the order someone checks a claim they have
        already been given rather than the order a page is conventionally built.

        It is rendered outside `ReadMode` on purpose. The advanced view is the
        same book in more detail, not a different day, and a reader who has
        switched to the tables should still be told what the day is.
      */}
      <div className={mutedIf(staleness.stale)}>
        <VerdictLead input={simpleInput} research={researchLine} headingLevel={1} />
      </div>

      {/*
        Under the verdict, because it is the first qualification of it: the
        same reading means something different on the day it changed than on
        the fourth day it has said the same thing.
      */}
      <WhatChanged lines={whatChanged} />

      {/*
        Directly under the verdict, phrased as the question a sceptic asks on
        being handed one — not as an invitation to admire the record. The page
        it goes to is still called Track Record; this is the way in, not a
        rename.

        Outside the muted wrapper on purpose. When today's numbers are stale,
        the offer to go and check how yesterday's read settled is more useful
        than ever, not less.

        Set in the accent colour at the body size rather than as fine print.
        The first version of this used the smallest, faintest pair of tokens in
        the app and was invisible in practice — which defeats the whole point
        of asking the question, since the reader who most needs the record is
        the one not already looking for it.
      */}
      <p className="text-xs">
        <a
          href="/log"
          className="inline-flex items-center gap-1.5 font-bold text-flip underline decoration-dotted underline-offset-4 hover:text-term-text"
        >
          Did yesterday&rsquo;s read hold up?
          <span aria-hidden>&rarr;</span>
        </a>
      </p>

      <PageBar
        // Demoted to an `h2`: the verdict above is this page's `h1` now.
        titleLevel={2}
        title={mode === 'simple' ? `${data.symbol} Today` : `${data.symbol} Dealer Positioning`}
        description={PAGE_DESCRIPTIONS['/']}
        /*
          The quote date, not `asOfLabel`. `asOfLabel` is stamped at render
          time, so it always reads "just now" — which is fine when the feed is
          healthy and actively false the moment a stored snapshot is being
          served: the page would print "Data as of 23:40" directly under a
          banner saying the numbers are 26 hours old. This is the same field
          the staleness grader reads, so the stamp and the warning can no
          longer disagree.
        */
        asOfLabel={data.meta.quoteDateLabel}
      />

      <PositioningSearch initial={data.symbol} />

      {/*
        The frame the verdict should be taken in: a clean level on a day when
        nothing is participating is a different thing from the same level on a
        broad one. Below the verdict rather than above it — it qualifies a read
        the reader has now already had.
      */}
      <div className="space-y-2">{contextRow}</div>

      {/*
        Outside the mode toggle, because it qualifies both views equally — the
        simple wording is if anything the easier one to take at face value.
      */}
      <DealerConventionNote symbol={data.symbol} />

      {/*
        Simple leads. The exposure tables are the same data one tap away, and
        the toggle remembers which side the reader chose.
      */}
      <div className={mutedIf(staleness.stale)}>
        <ReadMode simple={<WhatToWatch input={simpleInput} />} advanced={<Advanced />} />
      </div>

      {/*
        Outside the muted wrapper. When the data is stale the numbers are dimmed
        and the explanation of where they came from is the one thing that should
        stay fully legible.
      */}
      <MethodologyDrawer methodology={methodology} anchor="levels" />

      {/*
        Last on the page, which is the point: the reader has had the verdict
        and the backdrop, and this is where they go next. On a phone it also
        stands in for a nav bar there is no room for — the same grid is in the
        mobile menu.
      */}
      <ResearchCards />
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
              /*
                No provider name and no plan detail. Which upstream is
                configured, and what it costs, is an operational fact that
                belongs on /status — not in a tooltip on a button a visitor is
                about to press.
              */
              title={`Data is refreshed at most every ${Math.round(data.meta.cacheSeconds / 60)} minutes. Reloading before then re-reads the same snapshot.`}
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
