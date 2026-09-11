// Type-only, so this stays free of a runtime `../` import the verify loader
// cannot resolve. The band's own Calm/Wild wording and success/warning tones
// are deliberately its own — see `regimeBand` below — rather than reusing the
// uppercase CALM/WILD from `lib/regime`.
import type { Regime } from '../regime';
import { holdRate, windowRange, type DailyBar, type HoldResult, type WindowRange } from './backtest';

/** The plain word the band shows, from the stored regime. */
function moodWord(regime: Regime): 'Calm' | 'Wild' {
  return regime === 'positive' ? 'Calm' : 'Wild';
}

/**
 * The whole context band, assembled once on the server.
 *
 * ## Why the band is built here and not in the component
 *
 * The band's 5-day / 20-day switch is a client-side toggle that must survive a
 * reload, so the band itself is a client component. But nothing it shows may be
 * computed in the browser: the hold rates are a backtest over daily bars, the
 * regime run comes from the accuracy log, the events come from the calendar —
 * all server data. So both horizons are computed here, in full, and handed over
 * as plain data. Switching horizon then picks between two pre-computed answers
 * rather than recomputing anything, which is what lets the toggle be instant
 * and the numbers be honest at the same time.
 *
 * Pure and fed entirely by its argument, so the verify script drives the exact
 * function the page calls — see `scripts/verify-context-band.mjs`.
 */

/** The two horizons the band offers, as session counts. */
export const HORIZONS = [5, 20] as const;
export type Horizon = (typeof HORIZONS)[number];

export type LevelKey = 'callWall' | 'putWall';

export interface BandLevel {
  key: LevelKey;
  /** Uppercase plain name, e.g. `CALL WALL`. */
  name: string;
  price: number;
  /** Signed percentage distance from spot. */
  distancePct: number;
  /** Which side of spot the level sits — how price approaches it. */
  side: 'above' | 'below';
}

export interface HorizonView {
  horizon: Horizon;
  /** Hold result per level, keyed so the band can align it to its level row. */
  holds: Record<LevelKey, HoldResult>;
  /** The dates the window actually covers, or null when there are no bars. */
  window: WindowRange | null;
  /** Scheduled macro events that fell inside the window. */
  eventCount: number;
  /** Their names, newest first, for a compact list or tooltip. */
  eventNames: string[];
}

export interface RegimeBand {
  /** The headline word. */
  word: 'Calm' | 'Wild';
  /** Success for calm, warning for wild — the band's own mapping. */
  tone: 'success' | 'warning';
  flipLevel: number | null;
  /** Signed percentage distance from spot to the flip. */
  flipDistancePct: number | null;
  /** True whenever a flip exists — above it is the calmer side by definition. */
  aboveIsCalmer: boolean;
  /** "Unchanged since Aug 21", "Changed Sep 9", or an honest fallback. */
  changeLine: string;
  /**
   * Set only when the option chain and the intraday level feed disagree about
   * the regime, so the band can show the conflict rather than pick a winner.
   */
  disagreement: string | null;
}

export interface MarketBand {
  /** Share of the S&P above yesterday's close, 0-100, or null when unmeasured. */
  breadthPct: number | null;
  /** Green over 50, red under, neutral when unmeasured. */
  breadthTone: 'up' | 'down' | 'neutral';
  /** Honest one-liner: an index ETF has no earnings; a stock is not tracked. */
  earnings: string;
  vrp: {
    /** Implied minus realised, in volatility points, or null when uncomputable. */
    valuePts: number | null;
    /** One line saying why it is null. */
    reason: string | null;
  };
}

export interface ContextBand {
  symbol: string;
  spot: number;
  quoteDateLabel: string;
  stale: boolean;
  /** Call wall above spot, put wall below — either may be absent. */
  levels: BandLevel[];
  regime: RegimeBand;
  market: MarketBand;
  /** One view per horizon, in `HORIZONS` order. */
  horizons: HorizonView[];
}

/** One session's side of the flip, or null when there was no flip to take a side of. */
export interface RegimeSide {
  date: string;
  side: 'above' | 'below' | null;
}

export interface BuildContextBandInput {
  symbol: string;
  spot: number;
  quoteDateLabel: string;
  stale: boolean;
  regime: Regime;
  /**
   * The regime the intraday level feed last confirmed, or null when there is
   * nothing to compare against. Same value as `regime` means agreement.
   */
  observedRegime: Regime | null;
  flipLevel: number | null;
  flipDistancePct: number | null;
  magnetAbove: { strike: number; distancePct: number } | null;
  magnetBelow: { strike: number; distancePct: number } | null;
  /** Daily bars, oldest first, for the hold-rate backtest. */
  dailyBars: DailyBar[];
  breadthPct: number | null;
  /** Implied vol (annualised decimal) of the ~1-month ATM contract, or null. */
  atmIv: number | null;
  /** Annualised realised volatility, as the forecast measured it, or null. */
  realisedVol: number | null;
  /**
   * Whether session-over-session regime history is tracked for this symbol.
   * The accuracy log holds one symbol, so this is true for that symbol alone.
   */
  regimeTracked: boolean;
  /** One entry per settled session, any order — sorted here. */
  regimeSides: RegimeSide[];
  /**
   * Count scheduled events inside a date range. Injected rather than imported
   * so this module stays pure and testable; the page passes the calendar-aware
   * lookup.
   */
  eventsInWindow: (from: string, to: string) => { count: number; names: string[] };
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `2026-08-21` -> `Aug 21`. */
function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11 || !d) return iso;
  return `${MONTHS[idx]} ${Number(d)}`;
}

/**
 * The regime-change line, from the session-over-session flip side.
 *
 * Walks the sessions newest-first: the current run is every consecutive
 * session on the same side as the latest one. A side of null breaks the run —
 * a session with no flip is "cannot say", not "same as before". If the session
 * just before the run sat on the other side, the regime changed at the run's
 * start; otherwise it has held for as far back as the record goes.
 */
function regimeChangeLine(tracked: boolean, sides: RegimeSide[]): string {
  if (!tracked) {
    return 'Session-over-session history is kept for the tracked symbol only.';
  }

  const ordered = [...sides].sort((a, b) => b.date.localeCompare(a.date));
  const current = ordered[0];
  if (!current || current.side === null) {
    return 'Not enough settled sessions yet to say whether it has changed.';
  }

  let runStart = current.date;
  let i = 1;
  for (; i < ordered.length; i += 1) {
    if (ordered[i].side !== current.side) break;
    runStart = ordered[i].date;
  }

  const before = ordered[i];
  // A real crossing needs the prior session to have sat on the *other* side;
  // a null there is "cannot say", which is not evidence of a change.
  if (before && before.side !== null && before.side !== current.side) {
    return `Changed ${dayLabel(runStart)}`;
  }

  return `Unchanged since ${dayLabel(runStart)}`;
}

function buildLevels(input: BuildContextBandInput): BandLevel[] {
  const levels: BandLevel[] = [];
  if (input.magnetAbove) {
    levels.push({
      key: 'callWall',
      name: 'CALL WALL',
      price: input.magnetAbove.strike,
      distancePct: input.magnetAbove.distancePct,
      side: 'above',
    });
  }
  if (input.magnetBelow) {
    levels.push({
      key: 'putWall',
      name: 'PUT WALL',
      price: input.magnetBelow.strike,
      distancePct: input.magnetBelow.distancePct,
      side: 'below',
    });
  }
  return levels;
}

function horizonView(
  input: BuildContextBandInput,
  levels: BandLevel[],
  horizon: Horizon,
): HorizonView {
  const holds = {
    callWall: emptyHold(),
    putWall: emptyHold(),
  } as Record<LevelKey, HoldResult>;

  for (const level of levels) {
    holds[level.key] = holdRate(input.dailyBars, level.price, level.side, horizon);
  }

  const window = windowRange(input.dailyBars, horizon);
  const events = window
    ? input.eventsInWindow(window.from, window.to)
    : { count: 0, names: [] };

  return {
    horizon,
    holds,
    window,
    eventCount: events.count,
    eventNames: events.names,
  };
}

/** A hold result for a level that is not present, so the record is always full. */
function emptyHold(): HoldResult {
  return { rate: null, tested: 0, held: 0, reason: 'no level on this side' };
}

function buildVrp(atmIv: number | null, realisedVol: number | null): MarketBand['vrp'] {
  if (atmIv === null) {
    return { valuePts: null, reason: 'no near-month option to read implied volatility from' };
  }
  if (realisedVol === null) {
    return { valuePts: null, reason: 'not enough price history to measure realised volatility' };
  }
  // Both are annualised decimals; the premium is stated in volatility points.
  return { valuePts: (atmIv - realisedVol) * 100, reason: null };
}

function earningsLine(symbol: string): string {
  // SPY is the tracked index ETF and has no earnings. Single stocks would, but
  // there is no earnings feed here, so the honest answer is that it is not
  // tracked rather than a guessed date.
  return symbol === 'SPY'
    ? 'None — SPY is an index ETF'
    : 'Not tracked for this ticker';
}

export function buildContextBand(input: BuildContextBandInput): ContextBand {
  const levels = buildLevels(input);
  const disagrees =
    input.observedRegime !== null && input.observedRegime !== input.regime;

  const regime: RegimeBand = {
    word: moodWord(input.regime),
    tone: input.regime === 'positive' ? 'success' : 'warning',
    flipLevel: input.flipLevel,
    flipDistancePct: input.flipDistancePct,
    aboveIsCalmer: input.flipLevel !== null,
    changeLine: regimeChangeLine(input.regimeTracked, input.regimeSides),
    disagreement: disagrees
      ? `The intraday level feed last read ${moodWord(input.observedRegime as Regime)}. The two readings disagree.`
      : null,
  };

  const breadthPct = input.breadthPct;
  const market: MarketBand = {
    breadthPct,
    breadthTone:
      breadthPct === null ? 'neutral' : breadthPct >= 50 ? 'up' : 'down',
    earnings: earningsLine(input.symbol),
    vrp: buildVrp(input.atmIv, input.realisedVol),
  };

  return {
    symbol: input.symbol,
    spot: input.spot,
    quoteDateLabel: input.quoteDateLabel,
    stale: input.stale,
    levels,
    regime,
    market,
    horizons: HORIZONS.map((h) => horizonView(input, levels, h)),
  };
}
