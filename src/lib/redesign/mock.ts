/**
 * MOCK DATA for the layout-first redesign preview.
 *
 * ⚠️  Everything in this file is placeholder data. It exists so the integrated
 * Home layout and the Macro Bias placements can be previewed as structure
 * before any real data is wired in. Nothing here calls an upstream, reads a
 * store, or reflects the live market — every number is invented.
 *
 * The real-data phase replaces these `getMock*` reads with the existing
 * server-side fetches (positioning, forecast, groups, flow, netLiquidity,
 * breadth, quotes, macroBias). The component prop shapes are deliberately close
 * to the real domain types so that swap is mechanical.
 */

export const MOCK_NOTICE =
  'Preview layout — every figure on this page is placeholder data, not the live market.';

// --- freshness / market status ---------------------------------------------

export type FreshnessLevel = 'fresh' | 'stale' | 'updating';

export interface MarketStatusMock {
  /** `open` | `closed` | `pre` | `post`. */
  phase: 'open' | 'closed' | 'pre' | 'post';
  /** Human phase label, e.g. "Market open". */
  phaseLabel: string;
  /** How old the underlying snapshot is, graded. */
  freshness: FreshnessLevel;
  /** e.g. "as of 15:52 ET" or "Friday's close". */
  asOfLabel: string;
}

export const mockStatus: MarketStatusMock = {
  phase: 'open',
  phaseLabel: 'Market open',
  freshness: 'fresh',
  asOfLabel: 'as of 15:52 ET',
};

// --- hero: regime + key gamma levels ----------------------------------------

export interface GammaLevelsMock {
  symbol: string;
  spot: number;
  regime: 'positive' | 'negative';
  regimeLabel: string;
  /** One-line plain-English read of the regime. */
  regimeSub: string;
  netGex: string;
  flipLevel: number | null;
  magnetAbove: number | null;
  magnetBelow: number | null;
  /** Small ordered strip of nearby strikes and their gamma weight (0..1). */
  strip: { strike: number; weight: number; side: 'call' | 'put' }[];
}

export const mockLevels: GammaLevelsMock = {
  symbol: 'SPY',
  spot: 573.4,
  regime: 'positive',
  regimeLabel: 'Positive gamma',
  regimeSub:
    'Dealers are long gamma, so their hedging leans against moves — expect chop and mean reversion around the magnets.',
  netGex: '+$4.1B',
  flipLevel: 569,
  magnetAbove: 575,
  magnetBelow: 570,
  strip: [
    { strike: 562, weight: 0.22, side: 'put' },
    { strike: 565, weight: 0.35, side: 'put' },
    { strike: 567, weight: 0.51, side: 'put' },
    { strike: 570, weight: 0.82, side: 'put' },
    { strike: 573, weight: 0.4, side: 'call' },
    { strike: 575, weight: 1.0, side: 'call' },
    { strike: 577, weight: 0.66, side: 'call' },
    { strike: 580, weight: 0.55, side: 'call' },
    { strike: 585, weight: 0.3, side: 'call' },
  ],
};

// --- macro bias (first-class, inspectable) ----------------------------------

export type DriverState = 'headwind' | 'neutral' | 'tailwind';

export interface MacroDriverMock {
  key: string;
  label: string;
  /** Current reading, formatted for display. */
  value: string;
  state: DriverState;
  /** One short clause on what this driver is doing. */
  note: string;
}

export interface MacroBiasMock {
  /** Direction label — never a buy/sell instruction. */
  label: string;
  /** Direction score on a −5..+5 scale. */
  score: number;
  /** Confidence 0..100, independent of direction. */
  confidence: number;
  /** Score at the prior session's close, for the "changed since" line. */
  priorScore: number;
  /** Plain-English one-liner. */
  reason: string;
  /** Next scheduled catalyst. */
  nextCatalyst: { label: string; when: string; hoursAway: number };
  drivers: MacroDriverMock[];
  /** Append-only daily history, newest first. */
  history: {
    date: string;
    score: number;
    changed: string;
    nextEvent: string;
  }[];
}

export const mockMacro: MacroBiasMock = {
  label: 'Cautiously bearish',
  score: -2,
  confidence: 61,
  priorScore: -1,
  reason:
    'Rates and the dollar are leaning against risk while volatility stays subdued — a headwind, not a warning.',
  nextCatalyst: { label: 'CPI (Aug)', when: 'Tomorrow 08:30 ET', hoursAway: 16 },
  drivers: [
    { key: 'rates', label: 'Rates', value: '10Y 4.31%', state: 'headwind', note: 'yields drifting up' },
    { key: 'dollar', label: 'Dollar', value: 'DXY 104.8', state: 'headwind', note: 'firm, risk-negative' },
    { key: 'vol', label: 'Volatility', value: 'VIX 14.2', state: 'tailwind', note: 'calm tape' },
    { key: 'breadth', label: 'Breadth', value: '58% > prior', state: 'neutral', note: 'mixed participation' },
    { key: 'credit', label: 'Credit', value: 'HY OAS 3.1%', state: 'neutral', note: 'spreads stable' },
    { key: 'event', label: 'Event risk', value: 'CPI <24h', state: 'headwind', note: 'inflation print tomorrow' },
  ],
  history: [
    { date: 'Fri Sep 26', score: -1, changed: 'Dollar flipped to headwind', nextEvent: 'CPI (Aug)' },
    { date: 'Thu Sep 25', score: 0, changed: 'VIX eased to tailwind', nextEvent: 'Jobless claims' },
    { date: 'Wed Sep 24', score: -1, changed: 'Rates ticked to headwind', nextEvent: 'New home sales' },
  ],
};

// --- market health -----------------------------------------------------------

export interface MarketHealthMock {
  breadthPct: number;
  vix: { value: number; changePct: number };
  indices: { symbol: string; last: number; changePct: number }[];
}

export const mockHealth: MarketHealthMock = {
  breadthPct: 58,
  vix: { value: 14.2, changePct: -3.1 },
  indices: [
    { symbol: 'SPY', last: 573.4, changePct: 0.42 },
    { symbol: 'QQQ', last: 486.1, changePct: 0.61 },
    { symbol: 'IWM', last: 221.7, changePct: -0.18 },
  ],
};

// --- forward outlook ---------------------------------------------------------

export interface ForwardOutlookMock {
  lean: 'higher' | 'lower';
  higherPct: number;
  horizonLabel: string;
  downturnPct: number;
  downturnLabel: string;
}

export const mockOutlook: ForwardOutlookMock = {
  lean: 'higher',
  higherPct: 54,
  horizonLabel: 'next 5 sessions',
  downturnPct: 6.2,
  downturnLabel: 'CAUTIOUS',
};

// --- net liquidity -----------------------------------------------------------

export interface NetLiquidityMock {
  value: string;
  weeklyChange: string;
  weeklyUp: boolean;
  trend: number[];
}

export const mockNetLiquidity: NetLiquidityMock = {
  value: '$6.24T',
  weeklyChange: '−$38B',
  weeklyUp: false,
  trend: [6.31, 6.3, 6.28, 6.29, 6.27, 6.26, 6.24],
};

// --- leadership --------------------------------------------------------------

export interface LeadershipMock {
  sectors: { name: string; changePct: number }[];
  leaders: { symbol: string; score: number }[];
  laggards: { symbol: string; score: number }[];
}

export const mockLeadership: LeadershipMock = {
  sectors: [
    { name: 'Technology', changePct: 1.2 },
    { name: 'Communications', changePct: 0.8 },
    { name: 'Energy', changePct: -0.9 },
  ],
  leaders: [
    { symbol: 'NVDA', score: 94 },
    { symbol: 'AVGO', score: 89 },
    { symbol: 'META', score: 86 },
  ],
  laggards: [
    { symbol: 'XOM', score: 21 },
    { symbol: 'CVX', score: 24 },
    { symbol: 'PFE', score: 27 },
  ],
};

// --- scanner shortlist + watchlist changes -----------------------------------

export interface ScannerShortlistMock {
  shortlist: { symbol: string; score: number; macro: MacroAlignment }[];
  watchlistChanges: { symbol: string; change: string }[];
}

export type MacroAlignment =
  | 'aligned'
  | 'conflicted'
  | 'event-risk'
  | 'rate-sensitive'
  | 'defensive'
  | 'cyclical';

export const mockScanner: ScannerShortlistMock = {
  shortlist: [
    { symbol: 'NVDA', score: 91, macro: 'conflicted' },
    { symbol: 'JPM', score: 84, macro: 'rate-sensitive' },
    { symbol: 'WMT', score: 79, macro: 'defensive' },
    { symbol: 'CAT', score: 76, macro: 'cyclical' },
  ],
  watchlistChanges: [
    { symbol: 'AAPL', change: 'crossed above flip' },
    { symbol: 'TSLA', change: 'new magnet at 250' },
  ],
};

// --- options flow ------------------------------------------------------------

export interface OptionsFlowMock {
  highlights: { symbol: string; note: string; ratio: string }[];
}

export const mockFlow: OptionsFlowMock = {
  highlights: [
    { symbol: 'SPY', note: '575C sweep', ratio: '3.1× avg' },
    { symbol: 'NVDA', note: 'put/call 0.4', ratio: '2.4× avg' },
    { symbol: 'AMD', note: '160C block', ratio: '1.9× avg' },
  ],
};

// --- track record ------------------------------------------------------------

export interface TrackRecordMock {
  hitRate: number;
  sample: number;
  lastCall: { date: string; read: string; outcome: 'held' | 'missed' };
}

export const mockTrackRecord: TrackRecordMock = {
  hitRate: 63,
  sample: 41,
  lastCall: { date: 'Fri Sep 26', read: 'Positive gamma, chop expected', outcome: 'held' },
};

// --- decision: macro fit -----------------------------------------------------

export interface MacroFitMock {
  symbol: string;
  sector: string;
  sensitivity: string;
  fit: 'aligned' | 'neutral' | 'conflicted';
  why: string;
  nextRisk: string;
}

export const mockMacroFit: MacroFitMock = {
  symbol: 'NVDA',
  sector: 'Technology',
  sensitivity: 'Rate-sensitive, high beta',
  fit: 'conflicted',
  why: 'A strong single-name setup, but rising rates and a firm dollar are a macro headwind for high-beta tech.',
  nextRisk: 'CPI tomorrow 08:30 ET',
};
