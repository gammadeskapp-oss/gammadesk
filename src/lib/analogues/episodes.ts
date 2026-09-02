import { LONGEST } from './forward';
import type { Bar, Match } from './types';

/**
 * Occurrences grouped into the stretches of market they actually came from.
 *
 * ## Why the chart cannot be drawn per occurrence
 *
 * Three consecutive down closes fired on 448 days of SPY, drawn from 155
 * non-overlapping stretches. Drawing 448 lines would draw the same stretches
 * over and over — March 2020 would contribute several near-identical paths —
 * and a reader judging the spread by the density of the bundle would read 155
 * observations as 448. The spread would look more robust than it is, which is
 * the exact failure this page exists to avoid.
 *
 * So the chart plots one line per episode, using the same grouping the honesty
 * caveat counts. That grouping is ANCHORED, not chained: the first occurrence
 * opens an episode, everything inside its 42-day window belongs to it, and the
 * next occurrence beyond that window opens the next one. See `buildMatches` for
 * why — chaining off the previous occurrence merged twelve years of SPY into a
 * single "stretch".
 *
 * Day zero is therefore the anchor, which is also when the stretch began.
 * Anchoring at the last occurrence instead would start the clock after most of
 * the move had already happened.
 */

export interface Episode {
  /** Index of the anchoring occurrence — day zero. */
  anchorIndex: number;
  /** Date of that anchor. */
  date: string;
  /** Calendar year. */
  year: string;
  /** Occurrences falling inside this anchor's window, the anchor included. */
  occurrences: number;
  /** Date of the last occurrence in the window, when there is more than one. */
  lastDate: string;
}

/**
 * Group matches into episodes.
 *
 * `overlapsPrevious` already carries the anchoring — false marks an anchor,
 * true marks a match inside an earlier anchor's window — so this reads the very
 * flag the episode COUNT is derived from. The two can never disagree.
 */
export function toEpisodes(matches: Match[]): Episode[] {
  const episodes: Episode[] = [];

  for (const match of matches) {
    const open = episodes[episodes.length - 1];
    if (!match.overlapsPrevious || !open) {
      episodes.push({
        anchorIndex: match.index,
        date: match.date,
        year: match.date.slice(0, 4),
        occurrences: 1,
        lastDate: match.date,
      });
      continue;
    }
    open.occurrences += 1;
    open.lastDate = match.date;
  }

  return episodes;
}

/** One episode's rebased path. */
export interface EpisodePath {
  date: string;
  year: string;
  occurrences: number;
  /**
   * Index 0 is day zero and always 100. Runs to `LONGEST` days, or stops short
   * when the series ends first — a path is never padded or extended, so a
   * recent episode simply draws a shorter line.
   */
  values: number[];
  /** Where the path finished, for picking out the extremes. */
  endValue: number;
}

export interface PathBand {
  /** Trading days after the signal, 0-42. */
  day: number;
  /** Episodes still contributing a value on this day. */
  n: number;
  median: number;
  p25: number;
  p75: number;
}

export interface PathsView {
  paths: EpisodePath[];
  band: PathBand[];
  /**
   * The two extreme finishers, identified by DATE rather than by year.
   *
   * A year is not an identity: highlighting by year lit up every episode that
   * happened to share a calendar year with the extreme, which on a dense
   * pattern meant a dozen amber lines instead of two.
   */
  bestDate: string | null;
  worstDate: string | null;
  /** Their years, for the caption. */
  bestYear: string | null;
  worstYear: string | null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Rebase every episode to 100 at its signal date and measure the spread.
 *
 * Nothing is smoothed, winsorised or clipped. 2008 and 2020 are supposed to
 * fly off the top and bottom of the chart — a reader deciding whether an
 * average comes from most cases or from two outliers needs to see the two
 * outliers, and a chart that tidied them away would answer the opposite
 * question to the one being asked.
 */
export function buildPaths(bars: Bar[], episodes: Episode[]): PathsView {
  const paths: EpisodePath[] = [];

  for (const episode of episodes) {
    const base = bars[episode.anchorIndex]?.close;
    if (!base || base <= 0) continue;

    const values: number[] = [];
    for (let day = 0; day <= LONGEST; day += 1) {
      const bar = bars[episode.anchorIndex + day];
      if (!bar) break;
      values.push((bar.close / base) * 100);
    }
    if (values.length < 2) continue;

    paths.push({
      date: episode.date,
      year: episode.year,
      occurrences: episode.occurrences,
      values,
      endValue: values[values.length - 1],
    });
  }

  const band: PathBand[] = [];
  for (let day = 0; day <= LONGEST; day += 1) {
    const values = paths
      .map((p) => p.values[day])
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    if (values.length === 0) continue;
    band.push({
      day,
      n: values.length,
      median: quantile(values, 0.5),
      p25: quantile(values, 0.25),
      p75: quantile(values, 0.75),
    });
  }

  /*
   * The extremes are picked on where each path FINISHED rather than on the
   * furthest it travelled. A path that fell 30% and recovered is not the one a
   * reader is trying to identify when they ask which line is the outlier.
   */
  let best: EpisodePath | null = null;
  let worst: EpisodePath | null = null;
  for (const path of paths) {
    if (!best || path.endValue > best.endValue) best = path;
    if (!worst || path.endValue < worst.endValue) worst = path;
  }

  return {
    paths,
    band,
    bestDate: best?.date ?? null,
    worstDate: worst?.date ?? null,
    bestYear: best?.year ?? null,
    worstYear: worst?.year ?? null,
  };
}
