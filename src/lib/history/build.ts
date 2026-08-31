import type { LogEntry } from '../log/types';
import type { Bar } from '../ticker/types';

/**
 * Joining recorded levels to the sessions that followed, and counting how
 * often price did anything at them.
 *
 * Pure and input-only so `verify:history` can drive it with hand-built days
 * whose answers are known by inspection. That matters more here than in most
 * of this codebase: the statistics below are the only place on the site that
 * makes a quantitative claim about whether the levels work, and a quietly
 * wrong denominator would be an overstatement nobody could see.
 */

/** How close counts as "price stopped at the level", as a fraction of it. */
export const BAND_PCT = 0.001;

export interface HistoryDay {
  date: string;
  bar: Bar;
  /** Underlying price when the levels were recorded that morning. */
  spotAtSnapshot: number | null;
  flip: number | null;
  /** Nearest strong wall above — what the site displays. Null before 2026-08-31. */
  stall: number | null;
  /** Nearest strong wall below. */
  bounce: number | null;
  /** The biggest-magnet pair, which is what older entries carry. */
  magnetAbove: number | null;
  magnetBelow: number | null;
  /** True when this day predates the displayed-level fields. */
  displayedLevelsMissing: boolean;
}

export interface LevelStats {
  label: string;
  /** Days where the level existed and the session reached it at all. */
  reached: number;
  /** Of those, days the session turned within the band. */
  stopped: number;
  /** Of those, days price closed clean through it. */
  wentThrough: number;
  /** Days the level existed, whether or not price got near it. */
  available: number;
}

export interface HistoryView {
  symbol: string;
  days: HistoryDay[];
  /** Earliest recorded level, for the "collecting since" line. */
  collectingSince: string | null;
  stats: { stall: LevelStats; bounce: LevelStats; flip: LevelStats };
  /** Sessions with any recorded level. The sample size, stated everywhere. */
  sampleSize: number;
  /** True when no level has ever been recorded. */
  empty: boolean;
  barsSource: 'polygon' | 'yahoo' | null;
  /** Days in the window whose entry predates the displayed-level fields. */
  legacyDefinitionDays: number;
}

function within(price: number, level: number): boolean {
  return Math.abs(price - level) <= level * BAND_PCT;
}

/**
 * Did the session stop at this level, or go through it?
 *
 * "Reached" means the day's range touched the band around the level at all —
 * days where price never got near are excluded from both counts rather than
 * silently scored as a success, which is the mistake that makes any level look
 * good.
 *
 * "Stopped" means the range turned there: for a level above, the high came
 * into the band and the close finished below it. "Went through" means the
 * close finished the other side. A day can be neither — it reached the band
 * and closed inside it — and that is counted in `reached` without being
 * claimed for either side.
 */
function scoreAgainst(
  bar: Bar,
  level: number,
  side: 'above' | 'below',
): { reached: boolean; stopped: boolean; wentThrough: boolean } {
  const touched =
    side === 'above'
      ? bar.high >= level * (1 - BAND_PCT)
      : bar.low <= level * (1 + BAND_PCT);

  if (!touched) return { reached: false, stopped: false, wentThrough: false };

  const closedThrough = side === 'above' ? bar.close > level : bar.close < level;
  const closedAt = within(bar.close, level);

  return {
    reached: true,
    stopped: !closedThrough && !closedAt,
    wentThrough: closedThrough && !closedAt,
  };
}

/**
 * The flip is scored differently, and has to be.
 *
 * It is not a wall price bounces off; it is the boundary between two regimes.
 * The question that matters is whether price stayed on the side it started —
 * which is what the accuracy log already judges — so "stopped" here means held
 * and "went through" means crossed and closed the other side.
 */
function scoreFlip(
  bar: Bar,
  flip: number,
  spotAtSnapshot: number | null,
): { reached: boolean; stopped: boolean; wentThrough: boolean } {
  if (spotAtSnapshot === null) return { reached: false, stopped: false, wentThrough: false };

  const startedAbove = spotAtSnapshot >= flip;
  const crossed = startedAbove ? bar.low < flip : bar.high > flip;
  if (!crossed) return { reached: false, stopped: false, wentThrough: false };

  const closedThrough = startedAbove ? bar.close < flip : bar.close > flip;
  return { reached: true, stopped: !closedThrough, wentThrough: closedThrough };
}

function emptyStats(label: string): LevelStats {
  return { label, reached: 0, stopped: 0, wentThrough: 0, available: 0 };
}

export function buildHistory(input: {
  entries: LogEntry[];
  bars: Bar[];
  symbol: string;
  window: number;
  barsSource: 'polygon' | 'yahoo' | null;
}): HistoryView {
  const { entries, bars, symbol, window, barsSource } = input;

  const byDate = new Map(entries.map((e) => [e.date, e]));

  /*
   * Driven by the bars, not the log.
   *
   * A session with a price bar and no log entry is a real trading day the
   * recorder missed, and it belongs on the chart as a gap. Driving off the log
   * instead would quietly close those gaps up and make the record look
   * continuous when it is not.
   */
  const recent = bars.slice(-window);

  const days: HistoryDay[] = recent.map((bar) => {
    const entry = byDate.get(bar.date);
    return {
      date: bar.date,
      bar,
      spotAtSnapshot: entry?.spotAtSnapshot ?? null,
      flip: entry?.flipLevel ?? null,
      stall: entry?.stallLevel ?? null,
      bounce: entry?.bounceLevel ?? null,
      magnetAbove: entry?.magnetAbove ?? null,
      magnetBelow: entry?.magnetBelow ?? null,
      // `undefined` means the field did not exist when this was written; an
      // explicit null means the chain had no qualifying wall that morning.
      displayedLevelsMissing: entry !== undefined && entry.stallLevel === undefined,
    };
  });

  const stall = emptyStats('Resistance / hedging response area');
  const bounce = emptyStats('Support / hedging response area');
  const flip = emptyStats('Gamma flip');

  for (const day of days) {
    /*
     * Scored against whichever definition that day actually recorded. Falling
     * back to the biggest magnet for older entries is what makes a
     * thirty-session window possible at all — but the two are different
     * measures, and the count of days using the old one is carried out to the
     * page so the mixture is visible rather than averaged away.
     */
    const stallLevel = day.stall ?? day.magnetAbove;
    const bounceLevel = day.bounce ?? day.magnetBelow;

    if (stallLevel !== null) {
      stall.available += 1;
      const r = scoreAgainst(day.bar, stallLevel, 'above');
      if (r.reached) stall.reached += 1;
      if (r.stopped) stall.stopped += 1;
      if (r.wentThrough) stall.wentThrough += 1;
    }

    if (bounceLevel !== null) {
      bounce.available += 1;
      const r = scoreAgainst(day.bar, bounceLevel, 'below');
      if (r.reached) bounce.reached += 1;
      if (r.stopped) bounce.stopped += 1;
      if (r.wentThrough) bounce.wentThrough += 1;
    }

    if (day.flip !== null) {
      flip.available += 1;
      const r = scoreFlip(day.bar, day.flip, day.spotAtSnapshot);
      if (r.reached) flip.reached += 1;
      if (r.stopped) flip.stopped += 1;
      if (r.wentThrough) flip.wentThrough += 1;
    }
  }

  // Same definition as `hasAnyLevel` below, applied to the joined day rather
  // than the raw entry — both must agree or the sample size and the
  // "collecting since" line describe different sets of days.
  const withLevels = days.filter(
    (d) =>
      d.flip !== null ||
      d.stall !== null ||
      d.bounce !== null ||
      d.magnetAbove !== null ||
      d.magnetBelow !== null,
  );

  /*
   * Every field that counts as "a level was recorded that day".
   *
   * The first version of this listed only the flip and the two magnets, which
   * was the complete set when it was written and stopped being so about ninety
   * lines earlier in this same change. An entry carrying a stall and a bounce
   * but no magnet — which is what a chain with no single dominant strike
   * produces — read as no history at all, and the page would have shown
   * "collecting since" over a chart that had data in it.
   */
  const hasAnyLevel = (e: LogEntry) =>
    e.flipLevel !== null ||
    e.magnetAbove !== null ||
    e.magnetBelow !== null ||
    (e.stallLevel ?? null) !== null ||
    (e.bounceLevel ?? null) !== null;

  const allDates = entries.filter(hasAnyLevel).map((e) => e.date).sort();

  return {
    symbol,
    days,
    collectingSince: allDates[0] ?? null,
    stats: { stall, bounce, flip },
    sampleSize: withLevels.length,
    empty: allDates.length === 0,
    barsSource,
    legacyDefinitionDays: days.filter((d) => d.displayedLevelsMissing).length,
  };
}

/** `4 of 11 days` — never a bare percentage on a sample this size. */
export function fraction(part: number, whole: number): string {
  if (whole === 0) return 'no days to measure';
  return `${part} of ${whole} day${whole === 1 ? '' : 's'}`;
}

/**
 * The sentence about what the numbers are worth.
 *
 * Not decoration. Ten sessions of anything is inside the range of coin
 * flipping, and a percentage printed without that said next to it invites
 * exactly the conclusion the number cannot support.
 */
export function sampleCaveat(sampleSize: number): string {
  if (sampleSize === 0) {
    return 'There is nothing to measure yet.';
  }
  if (sampleSize < 30) {
    return `This is ${sampleSize} session${sampleSize === 1 ? '' : 's'}. A sample this small proves nothing — the counts below are a record of what happened, not evidence that the levels work. Several months would be the minimum worth drawing a conclusion from.`;
  }
  return `This is ${sampleSize} sessions. That is still a small sample: it describes what happened over about six weeks and is not evidence that the levels work in general.`;
}
