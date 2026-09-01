import { HORIZONS } from './types';
import type {
  Bar, ConditionDef, ConditionResult, Honesty, HorizonStats, Match, Outcome,
} from './types';

/**
 * What followed each match, and the statistics over them.
 *
 * ## Truncation, not zero-filling
 *
 * A match twelve sessions from the end of the series has a 1, 5 and 10-day
 * outcome and does not have a 21 or 42-day one. It is left out of those rows
 * entirely rather than carried at its latest value, which is why every horizon
 * reports its own `n` and the page shows all five. Carrying the unfinished
 * window forward would bias the long horizons toward whatever the last few
 * weeks did, and the most recent matches are exactly the ones a reader is most
 * interested in — so the bias would land where it does the most damage.
 *
 * ## Drawdown is measured on closes
 *
 * The conditions fire on closes, so the window is measured on closes too.
 * Using intraday lows would report a deeper hole than the series that produced
 * the entry ever traded on the terms being compared, and the two numbers would
 * be quietly incommensurable.
 */

/** Longest horizon — also the window inside which two matches overlap. */
export const LONGEST = Math.max(...HORIZONS);

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Outcomes for one entry index, for every horizon that has fully elapsed. */
export function outcomesAt(bars: Bar[], index: number): Outcome[] {
  const entry = bars[index].close;
  const out: Outcome[] = [];

  for (const horizon of HORIZONS) {
    const end = index + horizon;
    if (end >= bars.length) continue;

    let deepest = 0;
    for (let i = index + 1; i <= end; i += 1) {
      const move = bars[i].close / entry - 1;
      if (move < deepest) deepest = move;
    }

    out.push({ horizon, ret: bars[end].close / entry - 1, drawdown: deepest });
  }

  return out;
}

export function buildMatches(bars: Bar[], indices: number[]): Match[] {
  return indices.map((index, i) => ({
    date: bars[index].date,
    index,
    close: bars[index].close,
    outcomes: outcomesAt(bars, index),
    /*
     * Overlap is measured against the immediately preceding match only. Two
     * matches 42 sessions apart share no forward window; three matches inside
     * one window each overlap the one before, which counts two of the three as
     * dependent — the honest reading, and the one the page states.
     */
    overlapsPrevious: i > 0 && index - indices[i - 1] < LONGEST,
  }));
}

function statsFor(matches: Match[], horizon: number): HorizonStats {
  const rows = matches
    .map((m) => ({ m, o: m.outcomes.find((o) => o.horizon === horizon) }))
    .filter((r): r is { m: Match; o: Outcome } => r.o !== undefined);

  const h = horizon as HorizonStats['horizon'];
  if (rows.length === 0) {
    return {
      horizon: h, n: 0, medianReturn: null, bestReturn: null, worstReturn: null,
      bestDate: null, worstDate: null, positivePct: null,
      medianDrawdown: null, worstDrawdown: null,
    };
  }

  const returns = rows.map((r) => r.o.ret).sort((a, b) => a - b);
  const drawdowns = rows.map((r) => r.o.drawdown).sort((a, b) => a - b);

  let best = rows[0];
  let worst = rows[0];
  for (const r of rows) {
    if (r.o.ret > best.o.ret) best = r;
    if (r.o.ret < worst.o.ret) worst = r;
  }

  return {
    horizon: h,
    n: rows.length,
    medianReturn: median(returns),
    bestReturn: best.o.ret,
    worstReturn: worst.o.ret,
    bestDate: best.m.date,
    worstDate: worst.m.date,
    positivePct: (rows.filter((r) => r.o.ret > 0).length / rows.length) * 100,
    medianDrawdown: median(drawdowns),
    // Drawdowns are all <= 0, so the deepest is the smallest.
    worstDrawdown: drawdowns[0],
  };
}

/** Under this many matches the table is labelled "pattern, not proof". */
export const THIN_SAMPLE = 10;

export function honestyOf(matches: Match[]): Honesty {
  const byYear = new Map<string, number>();
  for (const m of matches) {
    const year = m.date.slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }

  let clusteredYear: Honesty['clusteredYear'] = null;
  for (const [year, count] of byYear) {
    // Strictly more than half. Clustered history is one regime in disguise.
    if (count * 2 > matches.length && matches.length > 0) {
      clusteredYear = { year, count };
    }
  }

  return {
    thin: matches.length < THIN_SAMPLE,
    overlapping: matches.filter((m) => m.overlapsPrevious).length,
    clusteredYear,
  };
}

export function summarise(
  def: ConditionDef,
  bars: Bar[],
  indices: number[],
): ConditionResult {
  const matches = buildMatches(bars, indices);

  return {
    id: def.id,
    label: def.label,
    rule: def.rule,
    family: def.family,
    matches,
    firstMatch: matches[0]?.date ?? null,
    lastMatch: matches[matches.length - 1]?.date ?? null,
    activeToday:
      matches.length > 0 &&
      matches[matches.length - 1].index === bars.length - 1,
    horizons: HORIZONS.map((h) => statsFor(matches, h)),
    honesty: honestyOf(matches),
  };
}
