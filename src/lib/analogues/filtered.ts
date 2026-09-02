import { buildPaths, toEpisodes, type Episode, type PathsView } from './episodes';
import { baselineFor, buildMatches, honestyOf, summarise } from './forward';
import { sessionPasses, type ActiveFilters, type RegimeRow } from './regimes';
import { HORIZONS } from './types';
import type {
  BaselineStats, Bar, ConditionDef, ConditionResult, Match,
} from './types';

/**
 * One condition, narrowed to the sessions that met the chosen regime.
 *
 * ## The baseline is filtered too
 *
 * This is the part that would be easy to get wrong and impossible to see. If
 * the pattern days are narrowed to "VIX in its high third" and the comparison
 * row still covers all 8,455 sessions, then the gap between them is mostly
 * the difference between calm and panicked markets rather than anything the
 * pattern did. Every filtered view therefore recomputes the comparison over
 * the sessions that pass the SAME filter, so the two rows always describe the
 * same kind of day.
 *
 * ## The floor is on episodes, and it is a floor
 *
 * Below `MIN_EPISODES` separate stretches, no returns are shown at all. Not
 * greyed numbers, not a hedge, not a percentage with a warning next to it —
 * the numbers are withheld and the panel says the sample is too thin. Stacking
 * three filters on a condition that fired sixty times will get there quickly,
 * which is why the surviving episode count sits beside every filter as the
 * reader stacks them.
 */

/** Separate stretches required before any return is displayed. */
export const MIN_EPISODES = 10;

export interface FilteredCondition {
  /** Stats over the surviving matches. Null when the floor is not met. */
  result: ConditionResult | null;
  /** Comparison row over sessions passing the same filter. Null when thin. */
  baseline: BaselineStats[] | null;
  /** Paths for the chart. Null when the floor is not met. */
  paths: PathsView | null;
  /** Always reported, floor met or not — this is what the reader watches. */
  episodes: number;
  matches: number;
  /** True when there are too few separate stretches to show anything. */
  tooThin: boolean;
  /** Sessions the comparison row rests on, after filtering. */
  baselineDays: number;
}

/**
 * Matches whose own session passes the filter.
 *
 * Filtered on the session that COMPLETED the pattern, which is the day the
 * reader would have been looking at it. Filtering on the whole forward window
 * instead would ask what the regime did afterwards, and that is not knowable
 * at the signal.
 */
function passingMatches(
  matches: Match[],
  regimes: RegimeRow[],
  active: ActiveFilters,
): Match[] {
  return matches.filter((m) => sessionPasses(regimes[m.index], active));
}

/** Episodes are regrouped after filtering, never carried over from before. */
function regroup(bars: Bar[], kept: Match[]): { matches: Match[]; episodes: Episode[] } {
  /*
   * Rebuilt from the surviving indices so overlap is recomputed against the
   * matches that remain. Reusing the unfiltered flags would count a survivor
   * as overlapping a neighbour the filter has just removed, and the episode
   * count — the number the floor is enforced on — would be too low.
   */
  const rebuilt = buildMatches(bars, kept.map((m) => m.index));
  return { matches: rebuilt, episodes: toEpisodes(rebuilt) };
}

/** The comparison row over every session that passes the filter. */
function filteredBaseline(
  bars: Bar[],
  regimes: RegimeRow[],
  active: ActiveFilters,
): { stats: BaselineStats[]; days: number } {
  if (Object.keys(active).length === 0) {
    return {
      stats: HORIZONS.map((h) => baselineFor(bars, h)),
      days: bars.length,
    };
  }

  const indices: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    if (sessionPasses(regimes[i], active)) indices.push(i);
  }

  return { stats: baselineOver(bars, indices), days: indices.length };
}

/**
 * The comparison row over a chosen set of entry sessions.
 *
 * Deliberately the same shape and the same measurements as `baselineFor`, so a
 * filtered comparison and an unfiltered one are read the same way. The only
 * difference is which entries are eligible.
 */
export function baselineOver(bars: Bar[], indices: number[]): BaselineStats[] {
  return HORIZONS.map((horizon) => {
    const returns: number[] = [];
    const drawdowns: number[] = [];

    for (const i of indices) {
      if (i + horizon >= bars.length) continue;
      const entry = bars[i].close;
      if (entry <= 0) continue;

      let deepest = 0;
      for (let j = i + 1; j <= i + horizon; j += 1) {
        const move = bars[j].close / entry - 1;
        if (move < deepest) deepest = move;
      }
      returns.push(bars[i + horizon].close / entry - 1);
      drawdowns.push(deepest);
    }

    const h = horizon as BaselineStats['horizon'];
    if (returns.length === 0) {
      return {
        horizon: h, n: 0, medianReturn: null, positivePct: null,
        medianDrawdown: null,
      };
    }

    const positive = returns.filter((r) => r > 0).length;
    returns.sort((a, b) => a - b);
    drawdowns.sort((a, b) => a - b);
    const mid = (arr: number[]) =>
      arr.length % 2 === 0
        ? (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2
        : arr[Math.floor(arr.length / 2)];

    return {
      horizon: h,
      n: returns.length,
      medianReturn: mid(returns),
      positivePct: (positive / returns.length) * 100,
      medianDrawdown: mid(drawdowns),
    };
  });
}

export function applyFilters(
  def: ConditionDef,
  bars: Bar[],
  allMatches: Match[],
  regimes: RegimeRow[],
  active: ActiveFilters,
): FilteredCondition {
  const kept =
    Object.keys(active).length === 0
      ? allMatches
      : passingMatches(allMatches, regimes, active);

  const { matches, episodes } = regroup(bars, kept);
  const episodeCount = episodes.length;

  if (episodeCount < MIN_EPISODES) {
    return {
      result: null,
      baseline: null,
      paths: null,
      episodes: episodeCount,
      matches: matches.length,
      tooThin: true,
      baselineDays: 0,
    };
  }

  const baseline = filteredBaseline(bars, regimes, active);

  return {
    result: summarise(def, bars, matches.map((m) => m.index)),
    baseline: baseline.stats,
    paths: buildPaths(bars, episodes),
    episodes: episodeCount,
    matches: matches.length,
    tooThin: false,
    baselineDays: baseline.days,
  };
}

/**
 * How many episodes survive a candidate filter, without building anything
 * else. Used to print the surviving count beside each option before it is
 * chosen, so the reader sees the sample shrink as they stack filters.
 */
export function episodesUnder(
  bars: Bar[],
  allMatches: Match[],
  regimes: RegimeRow[],
  active: ActiveFilters,
): number {
  const kept =
    Object.keys(active).length === 0
      ? allMatches
      : passingMatches(allMatches, regimes, active);
  return toEpisodes(buildMatches(bars, kept.map((m) => m.index))).length;
}

/** Overlap and clustering over the surviving matches, for the caveats. */
export function honestyUnder(matches: Match[]) {
  return honestyOf(matches);
}
