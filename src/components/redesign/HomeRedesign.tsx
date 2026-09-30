import { HeroRegime } from './HeroRegime';
import { MacroBiasCard } from './MacroBiasCard';
import { HomeLevels } from './HomeLevels';
import { MethodDrawer } from './MethodDrawer';
import {
  ForwardOutlookPreview,
  LeadershipPreview,
  MarketHealthPreview,
  NetLiquidityPreview,
  OptionsFlowPreview,
  ScannerShortlistPreview,
  TrackRecordPreview,
} from './PreviewModules';
import type { HomeData } from '@/lib/redesign/data';

/**
 * The integrated Home Dashboard — Home and the old /dashboard merged into one
 * screen. Module order, top to bottom (numbers are for reference only and are
 * never shown in the UI):
 *
 *   1  market status / freshness  (the global sticky bar, in layout.tsx)
 *   2  SPY regime + key gamma levels   ← hero, visually heaviest
 *   3  macro bias + next event         ← first-class, directly under the hero
 *   4  SPY level / gamma map           ← collapsed on mobile
 *   5  market health
 *   6  forward outlook
 *   7  net liquidity
 *   8  leadership
 *   9  scanner shortlist + watchlist changes
 *   10 options flow highlights
 *   11 track record
 *   12 data & method drawer
 *
 * Modules 5–11 are teaser PREVIEW cards: real figures plus an "Open full view"
 * action, never the full tool. The hero, macro and map above them are the
 * heavy blocks the page leads with.
 *
 * Every figure now comes from the real server-side loader (`lib/redesign/data`).
 * Each source is allowed to fail on its own, so any module whose data did not
 * resolve renders a compact "unavailable" note rather than taking the page down
 * or showing invented numbers.
 */
function Unavailable({ title }: { title: string }) {
  return (
    <section className="panel p-4">
      <h2 className="label-xs">{title}</h2>
      <p className="mt-2 text-2xs leading-relaxed text-term-faint">
        Not available right now — the feed behind this module did not respond. The rest of the
        page is unaffected; try again shortly.
      </p>
    </section>
  );
}

export function HomeRedesign({ data }: { data: HomeData }) {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      {/* 2 — hero */}
      {data.levels ? <HeroRegime levels={data.levels} /> : <Unavailable title="SPY regime" />}

      {/* 3 — macro bias, first-class, directly under the hero */}
      {data.macro ? <MacroBiasCard macro={data.macro} /> : <Unavailable title="Macro bias" />}

      {/* 4 — gamma map (the real strike-by-strike profile; collapsed on mobile) */}
      {data.levels && data.profile ? (
        <HomeLevels levels={data.levels} profile={data.profile} />
      ) : (
        <Unavailable title="SPY level / gamma map" />
      )}

      {/* 5–11 — preview teasers */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {data.health ? <MarketHealthPreview data={data.health} /> : <Unavailable title="Market health" />}
        {data.outlook ? <ForwardOutlookPreview data={data.outlook} /> : <Unavailable title="Forward outlook" />}
        {data.netLiquidity ? <NetLiquidityPreview data={data.netLiquidity} /> : <Unavailable title="Net liquidity" />}
        {data.leadership ? <LeadershipPreview data={data.leadership} /> : <Unavailable title="Leadership" />}
        {data.scanner ? <ScannerShortlistPreview data={data.scanner} /> : <Unavailable title="Scanner shortlist" />}
        {data.flow ? <OptionsFlowPreview data={data.flow} /> : <Unavailable title="Options flow" />}
        {data.trackRecord ? <TrackRecordPreview data={data.trackRecord} /> : <Unavailable title="Track record" />}
      </div>

      {/* 12 — data & method */}
      <MethodDrawer />
    </main>
  );
}
