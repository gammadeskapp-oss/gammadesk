/**
 * Real-data loader for the integrated Home dashboard.
 *
 * This is the swap the mock file always pointed at: it fetches the same
 * server-side sources the old dashboard and the specialist pages use, and maps
 * each one into the prop shape the redesign components already accept. Every
 * source is fetched in parallel and allowed to fail on its own — a dead feed
 * costs the reader that one module, never the page — so every field on the
 * returned bundle is nullable, and `HomeRedesign` renders an honest
 * "unavailable" state wherever a source did not resolve.
 *
 * What is genuinely real here: the regime + key levels, the strike-by-strike
 * gamma profile, market health (breadth + index/VIX quotes), the forward
 * outlook, net liquidity, sector/leadership standings, the scanner shortlist,
 * options-flow highlights, and the accuracy track record. The macro bias is
 * mapped from the live 3-factor FRED reading and extended onto the −5…+5 scale
 * with the breadth and volatility inputs; its day-over-day delta and daily
 * history stay absent until the scoring store lands (see the note on
 * `mapMacro`).
 */

import 'server-only';

import { config } from '@/lib/config';
import { formatUsd } from '@/lib/format';
import { buildGammaProfile, type GammaProfileData } from '@/lib/gammaProfile';
import { peekPositioningView } from '@/lib/positioning';
import { getSpotQuote } from '@/lib/spot';
import { getBreadth } from '@/lib/breadth';
import type { BreadthReading } from '@/lib/breadth/types';
import { getMarketContextQuotes, type MarketContextQuotes } from '@/lib/marketContext/quotes';
import { getRichMacroBias, type RichMacroView } from '@/lib/macroBias';
import { peekForecast } from '@/lib/forecast';
import { getNetLiquidity } from '@/lib/netLiquidity';
import { getSectorsSnapshot } from '@/lib/sectors';
import { getGroupsSnapshot } from '@/lib/groups';
import { getFlowSnapshot } from '@/lib/flow';
import { readLog } from '@/lib/log/store';
import { summarise } from '@/lib/log/types';
import { readArchive } from '@/lib/scanner/archive';
import { eventRow } from '@/lib/events';
import { currentMarketStatus } from '@/lib/events';
import type { PositioningData } from '@/lib/types';
import { macroAlignmentFor, earningsWithin24h } from './macroAlignment';
import type {
  ForwardOutlookMock,
  GammaLevelsMock,
  LeadershipMock,
  MacroBiasMock,
  MacroDriverMock,
  MacroFitMock,
  MarketHealthMock,
  MarketStatusMock,
  NetLiquidityMock,
  OptionsFlowMock,
  ScannerShortlistMock,
  TrackRecordMock,
  DriverState,
} from './mock';

export interface HomeData {
  status: MarketStatusMock;
  levels: GammaLevelsMock | null;
  profile: GammaProfileData | null;
  macro: MacroBiasMock | null;
  health: MarketHealthMock | null;
  outlook: ForwardOutlookMock | null;
  netLiquidity: NetLiquidityMock | null;
  leadership: LeadershipMock | null;
  scanner: ScannerShortlistMock | null;
  flow: OptionsFlowMock | null;
  trackRecord: TrackRecordMock | null;
}

// --- status bar (pure, no upstream) -----------------------------------------

/**
 * The global status bar, from the market clock alone. Pure and cheap, so it is
 * safe to compute in the root layout on every route without an upstream call.
 */
export function loadMarketStatus(now: Date = new Date()): MarketStatusMock {
  const s = currentMarketStatus(now);
  const phase: MarketStatusMock['phase'] =
    s.phase === 'open'
      ? 'open'
      : s.phase === 'pre-open'
        ? 'pre'
        : s.phase === 'after-close'
          ? 'post'
          : 'closed';
  const phaseLabel =
    phase === 'open'
      ? 'Market open'
      : phase === 'pre'
        ? 'Pre-market'
        : phase === 'post'
          ? 'After hours'
          : 'Market closed';
  return {
    phase,
    phaseLabel,
    // Freshness here is about the trading session, not a snapshot age: live
    // while open, otherwise showing the last completed session.
    freshness: phase === 'open' ? 'fresh' : 'stale',
    asOfLabel: s.open ? 'Live prices' : s.showingLine || 'Last close',
  };
}

// --- hero: regime + key levels ----------------------------------------------

function regimeSubOf(regime: 'positive' | 'negative'): string {
  return regime === 'positive'
    ? 'Dealers are long gamma, so their hedging leans against moves — expect chop and mean reversion around the magnets.'
    : 'Dealers are short gamma, so their hedging runs with moves — expect trends to extend and swings to travel further.';
}

function heroStrip(profile: GammaProfileData, spot: number): GammaLevelsMock['strip'] {
  const maxAbs = profile.points.reduce((m, p) => Math.max(m, Math.abs(p.netGex)), 0) || 1;
  return profile.points
    .slice()
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, 9)
    .sort((a, b) => a.strike - b.strike)
    .map((p) => ({
      strike: p.strike,
      weight: Math.min(1, Math.abs(p.netGex) / maxAbs),
      side: (p.netGex >= 0 ? 'call' : 'put') as 'call' | 'put',
    }));
}

function mapLevels(data: PositioningData, profile: GammaProfileData, spot: number): GammaLevelsMock {
  const { summary } = data;
  const netGex = summary.netGex;
  return {
    symbol: data.symbol,
    spot,
    regime: summary.regime,
    regimeLabel: summary.regime === 'positive' ? 'Positive gamma' : 'Negative gamma',
    regimeSub: regimeSubOf(summary.regime),
    netGex: `${netGex > 0 ? '+' : ''}${formatUsd(netGex)}`,
    flipLevel: summary.flipLevel,
    magnetAbove: summary.magnetAbove?.strike ?? null,
    magnetBelow: summary.magnetBelow?.strike ?? null,
    strip: heroStrip(profile, spot),
  };
}

// --- macro bias --------------------------------------------------------------

/** `2026-09-26` → `Fri Sep 26`, for the history rows. */
function formatHistoryDate(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(t));
}

/**
 * Map the stored −5…+5 macro model onto the inspectable card. The score,
 * confidence, drivers, reason and history all come straight from the persisted
 * record (see `lib/macroBias/rich`); `priorScore` is the most recent prior day,
 * so the "changed since yesterday" line is a real day-over-day delta.
 */
function mapMacro(
  view: RichMacroView,
  catalyst: MacroBiasMock['nextCatalyst'],
): MacroBiasMock {
  const c = view.current;
  const drivers: MacroDriverMock[] = c.drivers.map((d) => ({
    key: d.key,
    label: d.label,
    value: d.value,
    state: d.state as DriverState,
    note: d.sub,
  }));
  return {
    label: c.label,
    score: c.score,
    confidence: c.confidence,
    priorScore: view.history[0]?.score ?? null,
    reason: c.reason,
    nextCatalyst: catalyst,
    drivers,
    history: view.history.map((h) => ({
      date: formatHistoryDate(h.date),
      score: h.score,
      changed: h.changed,
      nextEvent: h.nextEvent,
    })),
  };
}

// --- next catalyst (shared by macro bias + macro fit) ------------------------

function nextCatalyst(now: Date = new Date()): MacroBiasMock['nextCatalyst'] {
  const rows = eventRow(now);
  const next = rows.find((e) => e.importance === 'high') ?? rows[0] ?? null;
  if (!next) return { label: 'No scheduled catalyst', when: 'this session', hoursAway: 0 };
  return {
    label: next.name,
    when: `${next.when === 'today' ? 'Today' : 'Tomorrow'} ${next.timeEt} ET`,
    hoursAway: 0,
  };
}

// --- market health -----------------------------------------------------------

function mapHealth(breadth: BreadthReading | null, quotes: MarketContextQuotes | null): MarketHealthMock | null {
  const breadthPct = breadth?.computed?.pctAbovePriorClose ?? null;
  const vixQuote = quotes?.quotes.find((q) => q.symbol === '^VIX') ?? null;
  const indices = (quotes?.quotes ?? [])
    .filter((q) => q.symbol !== '^VIX')
    .map((q) => ({ symbol: q.label, last: q.price, changePct: q.changePct }));
  if (breadthPct === null && !vixQuote && indices.length === 0) return null;
  return {
    breadthPct: breadthPct === null ? 0 : Math.round(breadthPct),
    vix: vixQuote ? { value: vixQuote.price, changePct: vixQuote.changePct } : { value: 0, changePct: 0 },
    indices,
  };
}

// --- forward outlook ---------------------------------------------------------

async function mapOutlook(): Promise<ForwardOutlookMock | null> {
  const forecast = await peekForecast(config.symbol).catch(() => null);
  if (!forecast || forecast.odds.length === 0) return null;
  // The horizon nearest five sessions out, which is the module's headline.
  const odds = forecast.odds.reduce((best, o) =>
    Math.abs(o.day - 5) < Math.abs(best.day - 5) ? o : best,
  );
  const crash = forecast.crashPct;
  const downturnLabel = crash < 3 ? 'CALM' : crash < 7 ? 'CAUTIOUS' : 'ELEVATED';
  return {
    lean: odds.higherPct >= 50 ? 'higher' : 'lower',
    higherPct: Math.round(odds.higherPct),
    horizonLabel: odds.label,
    downturnPct: Number(crash.toFixed(1)),
    downturnLabel,
  };
}

// --- net liquidity -----------------------------------------------------------

async function mapNetLiquidity(): Promise<NetLiquidityMock | null> {
  const nl = await getNetLiquidity().catch(() => null);
  if (!nl) return null;
  const { latest, history } = nl;
  const change = latest.changeUsd ?? 0;
  return {
    value: formatUsd(latest.net),
    weeklyChange: change === 0 ? 'flat' : formatUsd(change),
    weeklyUp: change > 0,
    trend: history.slice(-7).map((w) => Number((w.net / 1e12).toFixed(2))),
  };
}

// --- leadership --------------------------------------------------------------

async function mapLeadership(): Promise<LeadershipMock | null> {
  const [sectors, groups] = await Promise.all([
    getSectorsSnapshot().catch(() => null),
    getGroupsSnapshot().catch(() => null),
  ]);
  if (!sectors && !groups) return null;

  // Sector session change = average of its members' session change.
  const sectorRows = (sectors?.sectors ?? [])
    .map((s) => {
      const members = s.members ?? [];
      const avg = members.length
        ? members.reduce((sum, m) => sum + m.changePct, 0) / members.length
        : 0;
      return { name: s.name, changePct: Number((avg * 100).toFixed(2)) };
    })
    .sort((a, b) => b.changePct - a.changePct);
  const sectorList = [...sectorRows.slice(0, 2), ...sectorRows.slice(-1)].filter(
    (v, i, arr) => arr.findIndex((x) => x.name === v.name) === i,
  );

  // Leaders / laggards from every scored name across the groups.
  const scored = (groups?.groups ?? [])
    .flatMap((g) => g.members)
    .map((m) => ({ symbol: m.symbol, score: m.total > 0 ? Math.round((m.bullish / m.total) * 100) : 0 }));
  const byScore = scored.slice().sort((a, b) => b.score - a.score);
  const leaders = byScore.slice(0, 3);
  const laggards = byScore.slice(-3).reverse();

  return { sectors: sectorList, leaders, laggards };
}

// --- scanner shortlist -------------------------------------------------------

async function mapScanner(now: Date = new Date()): Promise<ScannerShortlistMock | null> {
  const archive = await readArchive().catch(() => []);
  if (archive.length === 0) return null;
  const latest = archive.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const shortlist = latest.names
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((n) => ({
      symbol: n.symbol,
      score: Math.round(n.score),
      macro: macroAlignmentFor(n.symbol, earningsWithin24h(n.earningsDateIso, now)),
    }));
  // Watchlist membership is client-side only (localStorage), so there is no
  // server-side "what changed on your watchlist" to compute here.
  return { shortlist, watchlistChanges: [] };
}

// --- options flow ------------------------------------------------------------

async function mapFlow(): Promise<OptionsFlowMock | null> {
  const flow = await getFlowSnapshot().catch(() => null);
  if (!flow || flow.rows.length === 0) return null;
  const highlights = flow.rows
    .slice()
    .sort((a, b) => b.volumeToOi - a.volumeToOi)
    .slice(0, 3)
    .map((r) => ({
      symbol: r.symbol,
      note: `${r.strike}${r.type === 'call' ? 'C' : 'P'} ${r.expiryLabel}`,
      ratio: `${r.volumeToOi.toFixed(1)}× OI`,
    }));
  return { highlights };
}

// --- track record ------------------------------------------------------------

async function mapTrackRecord(): Promise<TrackRecordMock | null> {
  const log = await readLog().catch(() => []);
  if (log.length === 0) return null;
  const stats = summarise(log);
  if (stats.flipHeldPct === null) return null;
  const settled = log
    .filter((e) => e.settled && (e.flipOutcome === 'held' || e.flipOutcome === 'broke'))
    .sort((a, b) => b.date.localeCompare(a.date));
  const last = settled[0];
  const lastCall: TrackRecordMock['lastCall'] = last
    ? {
        date: last.date,
        read:
          last.regime === 'positive'
            ? 'Positive gamma, chop expected'
            : 'Negative gamma, trend risk',
        outcome: last.flipOutcome === 'held' ? 'held' : 'missed',
      }
    : { date: '—', read: 'No settled call yet', outcome: 'held' };
  return {
    hitRate: Math.round(stats.flipHeldPct),
    sample: stats.flipJudged,
    lastCall,
  };
}

// --- macro fit (decision workspace) -----------------------------------------

/**
 * A compact macro-fit read for one ticker, from the live macro bias and the
 * name's standing sensitivity. Honest and light: it names the sensitivity and
 * whether it aligns with or fights the current backdrop, never a price target.
 */
export async function loadMacroFit(symbol: string, now: Date = new Date()): Promise<MacroFitMock | null> {
  const view = await getRichMacroBias().catch(() => null);
  if (!view) return null;
  const alignment = macroAlignmentFor(symbol);
  const backdrop = view.current.direction; // bullish | bearish | neutral

  const sensitivity =
    alignment === 'rate-sensitive'
      ? 'Rate-sensitive'
      : alignment === 'defensive'
        ? 'Defensive'
        : alignment === 'cyclical'
          ? 'Cyclical, growth-geared'
          : 'No strong macro tilt';

  // Defensives align with a risk-off backdrop; cyclicals/rate-sensitives fight
  // it. The reverse holds when the backdrop is risk-on.
  let fit: MacroFitMock['fit'] = 'neutral';
  if (backdrop !== 'neutral' && alignment !== 'aligned') {
    const defensiveName = alignment === 'defensive';
    const riskOff = backdrop === 'bearish';
    fit = defensiveName === riskOff ? 'aligned' : 'conflicted';
  }

  const why =
    fit === 'conflicted'
      ? `The macro backdrop is leaning ${backdrop === 'bearish' ? 'risk-off' : 'risk-on'}, which works against a ${sensitivity.toLowerCase()} name like this.`
      : fit === 'aligned'
        ? `The macro backdrop is leaning ${backdrop === 'bearish' ? 'risk-off' : 'risk-on'}, which favours a ${sensitivity.toLowerCase()} name like this.`
        : 'No strong macro tilt for or against this name right now — the setup stands on its own.';

  return {
    symbol,
    sector: sensitivity,
    sensitivity,
    fit,
    why,
    nextRisk: nextCatalyst(now).label,
  };
}

// --- the whole bundle --------------------------------------------------------

export async function loadHomeData(now: Date = new Date()): Promise<HomeData> {
  const catalyst = nextCatalyst(now);

  const [book, breadth, quotes, richMacro, outlook, netLiquidity, leadership, scanner, flow, trackRecord] =
    await Promise.all([
      peekPositioningView(config.symbol).catch((): PositioningData | null => null),
      getBreadth().catch((): BreadthReading | null => null),
      getMarketContextQuotes().catch((): MarketContextQuotes | null => null),
      getRichMacroBias().catch((): RichMacroView | null => null),
      mapOutlook(),
      mapNetLiquidity(),
      mapLeadership(),
      mapScanner(now),
      mapFlow(),
      mapTrackRecord(),
    ]);

  let levels: GammaLevelsMock | null = null;
  let profile: GammaProfileData | null = null;
  if (book) {
    const spot = (await getSpotQuote(config.symbol).catch(() => null))?.price ?? book.spot;
    profile = buildGammaProfile(book);
    levels = mapLevels(book, profile, spot);
  }

  return {
    status: loadMarketStatus(now),
    levels,
    profile,
    macro: richMacro ? mapMacro(richMacro, catalyst) : null,
    health: mapHealth(breadth, quotes),
    outlook,
    netLiquidity,
    leadership,
    scanner,
    flow,
    trackRecord,
  };
}
