import type { LogEntry } from '../log/types';
// Type-only, so the server-only store this interface lives beside is erased
// at compile time and never pulled into a client bundle.
import type { ArchivedDay } from '../scanner/archive';

/**
 * What changed since the previous session, from what is already stored.
 *
 * ## What this is, and what it must never become
 *
 * Every line is a fact about a difference between two saved snapshots. Not a
 * suggestion, not an outlook, and never a reason to do anything — the reader
 * is being told what moved, and what to make of it is theirs.
 *
 * Declines are reported exactly as readily as improvements. A card that
 * surfaces the good news and stays quiet on the bad one is worse than no card,
 * because it teaches a reader that silence means nothing happened.
 *
 * ## Why so few lines
 *
 * Two, at the moment: the side of the volatility threshold, and the size of
 * the scanner shortlist. Those are the only two comparisons the store can
 * honestly support. Breadth and sector state are held as a single current
 * document that is replaced when the New York date changes, so yesterday's
 * value is not kept anywhere and a breadth line would have to be invented.
 * See `lib/history/session.ts` for the append-only series that will let those
 * lines turn on, and `buildWhatChanged`'s `sessions` argument for how.
 *
 * ## The missing-snapshot rule
 *
 * Each source needs BOTH the current session and the prior one before it says
 * anything. A source missing either contributes nothing at all rather than
 * comparing against whatever else it can find. This is the rule the earlier
 * false-green bug broke: an empty store read as "no stocks yesterday", which
 * diffed into a cheerful line about names arriving that had been there all
 * along. Absent is not zero, and it is not yesterday.
 */

/** One rendered line, with the rank that decides whether it survives the cap. */
interface Change {
  text: string;
  /**
   * Higher shows first. These are deliberately coarse: a structural change in
   * the day's character outranks a change in how many names passed a filter,
   * and within a kind the bigger move outranks the smaller.
   */
  weight: number;
}

/** At most this many lines reach the page. */
export const MAX_LINES = 4;

const WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
];

/** "Three" up to ten, then digits. Reads as prose at the sizes that occur. */
function count(n: number): string {
  return n <= 10 ? WORDS[n] : String(n);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function byDate<T extends { date: string }>(rows: T[], date: string): T | null {
  return rows.find((r) => r.date === date) ?? null;
}

/**
 * Which side of the flip level the snapshot sat on, or null when the day had
 * no flip level to be on a side of.
 *
 * Null is not a side. Two days where the level could not be computed are not
 * "unchanged", and treating them that way would let a line appear the moment
 * one of them resolved, reporting a move that never happened.
 */
function flipSide(entry: LogEntry): 'above' | 'below' | null {
  if (entry.flipLevel === null || !Number.isFinite(entry.flipLevel)) return null;
  return entry.spotAtSnapshot >= entry.flipLevel ? 'above' : 'below';
}

function volatilityThresholdChange(
  symbol: string,
  log: LogEntry[],
  today: string,
  prior: string,
): Change | null {
  const now = byDate(log, today);
  const before = byDate(log, prior);
  if (!now || !before) return null;

  const sideNow = flipSide(now);
  const sideBefore = flipSide(before);
  if (sideNow === null || sideBefore === null) return null;
  if (sideNow === sideBefore) return null;

  return {
    weight: 100,
    text:
      sideNow === 'above'
        ? `${symbol} moved back above its modeled volatility threshold.`
        : `${symbol} moved below its modeled volatility threshold.`,
  };
}

function shortlistChange(
  archive: ArchivedDay[],
  today: string,
  prior: string,
): Change[] {
  const now = byDate(archive, today);
  const before = byDate(archive, prior);
  if (!now || !before) return [];

  const held = new Set(before.names.map((n) => n.symbol));
  const current = new Set(now.names.map((n) => n.symbol));

  const entered = now.names.filter((n) => !held.has(n.symbol)).length;
  const left = before.names.filter((n) => !current.has(n.symbol)).length;

  const changes: Change[] = [];

  // Both directions, built the same way and weighted the same way. Neither is
  // the headline by default; the larger move goes first because it is the
  // larger move.
  if (entered > 0) {
    changes.push({
      weight: 50 + entered,
      text: `${count(entered)} ${plural(entered, 'stock', 'stocks')} entered the scanner shortlist.`,
    });
  }
  if (left > 0) {
    changes.push({
      weight: 50 + left,
      text: `${count(left)} ${plural(left, 'stock', 'stocks')} left the scanner shortlist.`,
    });
  }

  return changes;
}

export interface WhatChangedInput {
  symbol: string;
  /** The session being rendered, `YYYY-MM-DD` in New York. */
  today: string;
  /**
   * The trading day before it — from `priorSessionDate`, never `today` minus a
   * calendar day. Null when the calendar could not name one, which yields no
   * lines rather than a comparison against a date that is not a session.
   */
  prior: string | null;
  log: LogEntry[];
  archive: ArchivedDay[];
}

/**
 * The lines to show, most significant first, capped at `MAX_LINES`.
 *
 * An empty array means "nothing to say", and the caller must render nothing at
 * all — no heading, no placeholder, no empty state. A card that says it has
 * found no changes is a claim about the data; this one is only ever a report
 * of changes it did find.
 */
export function buildWhatChanged(input: WhatChangedInput): string[] {
  const { symbol, today, prior, log, archive } = input;
  if (prior === null) return [];

  const changes: Change[] = [];

  const volatility = volatilityThresholdChange(symbol, log, today, prior);
  if (volatility) changes.push(volatility);

  changes.push(...shortlistChange(archive, today, prior));

  return changes
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_LINES)
    .map((c) => c.text);
}
