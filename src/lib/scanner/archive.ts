import 'server-only';

import { createJsonStore } from '../jsonStore';
import { alignmentBadges, buildWatchLine, partition } from './evaluate';
import type {
  AlignmentBadge,
  OptionContract,
  OptionQualityBadge,
  ScanResult,
} from './types';

/**
 * The day-by-day record of what the scanner actually produced.
 *
 * ## Why this is a second store and not just a longer `keepDays`
 *
 * The scan document carries every candidate with its timeframe readings and
 * its magnets — a few hundred kilobytes a day, most of it drawing material for
 * a chart nobody reopens a week later. Keeping ninety days of that to answer
 * "how many names passed on Tuesday" would be the wrong trade.
 *
 * So this stores the answers rather than the workings: the names that passed,
 * their scores, their four badges, and the option numbers **as they were at
 * scan time**. A few hundred bytes a day, which can be kept for a quarter.
 *
 * ## Frozen on purpose
 *
 * The option numbers here are a snapshot, not a live read. A badge recomputed
 * today against today's chain would tell you what the contract looks like now,
 * which is a different and much less useful question than what the scan was
 * looking at when it put the name on the list. That is the whole point of an
 * archive: it is the record of a decision, and a record that updates itself is
 * not a record.
 *
 * ## The daily count
 *
 * `passed` is the number this file exists for. A rule set is only as good as
 * the number of names it actually clears on an ordinary day, and that is not
 * knowable from one morning — a floor that yields twenty-seven candidates and
 * three passes is a different instrument from one that yields twenty. The
 * count is stored every day, on every path, including the days the market gate
 * was shut and the answer was zero.
 */

const archiveStore = createJsonStore<StoredArchive>(
  'gammadesk/scanner-archive.json',
  () => ({ days: [] }),
  (raw) =>
    raw && typeof raw === 'object' && Array.isArray((raw as StoredArchive).days)
      ? (raw as StoredArchive)
      : null,
);

/** One name, as it stood on the morning it passed. */
export interface ArchivedName {
  symbol: string;
  score: number;
  rank: number;
  /** The four alignment badges, frozen. */
  badges: Array<{ key: AlignmentBadge['key']; state: AlignmentBadge['state'] }>;
  optionBadge: OptionQualityBadge | null;
  /** The graded contract, or null when none was graded that morning. */
  contract: OptionContract | null;
  /** Whether the chain behind it was pulled by the scan or on request. */
  optionSource: string | null;
  /** The risks named that day, kept verbatim. */
  watch: string;
  earningsDateIso: string | null;
}

/** One morning. */
export interface ArchivedDay {
  /** New York date. */
  date: string;
  scannedAt: string;
  /** The number this file exists for. */
  passed: number;
  /** Candidates that cleared the RS floor and were carried into the rest. */
  candidates: number;
  universe: number;
  rsMin: number;
  spyRegime: 'positive' | 'negative' | null;
  /** Set when the market gate was shut, so a zero reads as a reason. */
  gateReason: string | null;
  /** Names removed for reporting inside the earnings window. */
  earningsExcluded: number;
  /** How many contracts were graded at scan time. */
  qualityChecked: number;
  names: ArchivedName[];
}

export interface StoredArchive {
  days: ArchivedDay[];
}

/**
 * Days kept.
 *
 * A quarter, because the question this answers — is the floor set right — is
 * one you cannot answer from a week, and because at a few hundred bytes a day
 * there is no reason to keep less.
 */
export const ARCHIVE_KEEP_DAYS = 90;

/** Freeze one finished scan into the archive. Never throws. */
export async function archiveScan(result: ScanResult): Promise<void> {
  const { passed } = partition(result.rows);

  const day: ArchivedDay = {
    date: result.date,
    scannedAt: result.scannedAt,
    passed: passed.length,
    candidates: result.candidates,
    universe: result.universe,
    rsMin: result.rsMin,
    spyRegime: result.spyRegime,
    gateReason: result.gateReason,
    earningsExcluded: result.earningsExcluded.length,
    qualityChecked: result.qualityChecked,
    names: passed.map(({ row }) => ({
      symbol: row.symbol,
      score: row.rsScore,
      rank: row.rsRank,
      badges: alignmentBadges(row).map((b) => ({ key: b.key, state: b.state })),
      optionBadge: row.optionQuality?.badge ?? null,
      contract: row.optionQuality?.contract ?? null,
      optionSource: row.optionQuality?.source ?? null,
      watch: buildWatchLine(row).text,
      earningsDateIso: row.earnings.dateIso,
    })),
  };

  try {
    await archiveStore.update((current) => ({
      days: [day, ...current.days.filter((d) => d.date !== day.date)]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, ARCHIVE_KEEP_DAYS),
    }));
  } catch {
    /*
     * Swallowed deliberately. The archive is a record of the scan, not part of
     * it, and a storage failure here must not fail a scan that otherwise
     * succeeded — the reader would lose today's list to protect a history they
     * cannot see yet. `/status` reports the store's health separately.
     */
  }
}

/** Every archived morning, newest first. */
export async function readArchive(): Promise<ArchivedDay[]> {
  const stored = await archiveStore.read().catch(() => null);
  return stored?.days ?? [];
}

/**
 * The pass count per day, newest first, for the run-rate strip.
 *
 * Exposed separately from the full archive because it is the cheap question
 * and the one asked most often: over a week or two, how many names does this
 * rule set actually clear?
 */
export interface DailyCount {
  date: string;
  passed: number;
  candidates: number;
  /** True when the market gate was shut, so a zero can be read correctly. */
  gateShut: boolean;
}

export function dailyCounts(days: ArchivedDay[]): DailyCount[] {
  return days.map((d) => ({
    date: d.date,
    passed: d.passed,
    candidates: d.candidates,
    gateShut: d.gateReason !== null,
  }));
}

/**
 * Mean names per day across the archived window.
 *
 * ## Gate-shut days are counted, not excluded
 *
 * A zero because the market regime was volatile is a real zero. Dropping those
 * would answer a question nobody asked — "how many names pass on the days when
 * names pass" — and would flatter the rule set precisely on the days it is
 * doing its job. If the average over a fortnight is three, that is the number,
 * and it is the number the floor should be judged against.
 */
export function averagePerDay(days: ArchivedDay[]): number | null {
  if (days.length === 0) return null;
  const total = days.reduce((sum, d) => sum + d.passed, 0);
  return total / days.length;
}

export { archiveStore };
