import { LONGEST } from './forward';
import type { Bar, Match } from './types';

/**
 * Occurrences grouped into the stretches of market they actually came from.
 *
 * ## Why the chart cannot be drawn per occurrence
 *
 * Three consecutive down closes fired 448 times on SPY, and 411 of those fall
 * within 42 sessions of an earlier one. Drawing 448 lines would draw the same
 * few stretches of market over and over — March 2020 would contribute a dozen
 * near-identical paths — and a reader looking at the density of the bundle
 * would read a handful of episodes as hundreds of independent confirmations.
 * The spread would look far more robust than it is, which is the exact
 * failure this page exists to avoid.
 *
 * So the chart plots one line per episode. Same grouping the honesty caveat
 * already counts: a run of occurrences each within `LONGEST` sessions of the
 * one before is one episode. Day zero anchors at the FIRST occurrence in the
 * run, because that is when the stretch began — anchoring at the last would
 * quietly start the clock after most of the move had already happened.
 */

export interface Episode {
  /** Index of the first occurrence in the run — day zero. */
  anchorIndex: number;
  /** Date of that first occurrence. */
  date: string;
  /** Calendar year, for labelling the extreme lines. */
  year: string;
  /** How many occurrences the run contains. */
  occurrences: number;
  /** Date of the last occurrence, when the run holds more than one. */
  lastDate: string;
}

/**
 * Group matches into episodes.
 *
 * `overlapsPrevious` already carries the run structure — a match that does not
 * overlap its predecessor opens a new run — so this reads the same flag the
 * episode COUNT is derived from. The two can never disagree.
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
  /** Best and worst finishers, labelled on the chart. */
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
    bestYear: best?.year ?? null,
    worstYear: worst?.year ?? null,
  };
}
