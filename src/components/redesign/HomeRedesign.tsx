import { HeroRegime } from './HeroRegime';
import { MacroBiasCard } from './MacroBiasCard';
import { GammaMap } from './GammaMap';
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
import {
  MOCK_NOTICE,
  mockFlow,
  mockHealth,
  mockLeadership,
  mockLevels,
  mockMacro,
  mockNetLiquidity,
  mockOutlook,
  mockScanner,
  mockTrackRecord,
} from '@/lib/redesign/mock';

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
 * Layout-first preview: every figure is placeholder data from
 * `lib/redesign/mock`. Real wiring swaps those reads for the existing
 * server-side fetches.
 */
export function HomeRedesign() {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      <p className="panel border-l-2 border-l-flip/60 bg-flip/[0.05] px-3.5 py-2 text-2xs leading-relaxed text-flip">
        {MOCK_NOTICE}
      </p>

      {/* 2 — hero */}
      <HeroRegime levels={mockLevels} />

      {/* 3 — macro bias, first-class, directly under the hero */}
      <MacroBiasCard macro={mockMacro} />

      {/* 4 — gamma map (collapsed on mobile) */}
      <GammaMap levels={mockLevels} />

      {/* 5–11 — preview teasers */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <MarketHealthPreview data={mockHealth} />
        <ForwardOutlookPreview data={mockOutlook} />
        <NetLiquidityPreview data={mockNetLiquidity} />
        <LeadershipPreview data={mockLeadership} />
        <ScannerShortlistPreview data={mockScanner} />
        <OptionsFlowPreview data={mockFlow} />
        <TrackRecordPreview data={mockTrackRecord} />
      </div>

      {/* 12 — data & method */}
      <MethodDrawer />
    </main>
  );
}
