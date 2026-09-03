import 'server-only';

import { config } from '../config';
import { readTodaysScan } from '../scanner/run';
import { DEFAULT_FILTERS, SCORE_KEYS, scoreAndJudge } from '../scanner/score';
import { readCloses, closeOn } from './closes';
import { trackRecordStore } from './store';
import type { TrackRecordEntry } from './types';

/**
 * The 16:15 ET job: write down what the scanner put at the top today.
 *
 * ## Written after the close, about a list fixed in the morning
 *
 * The picks are read from the scan stored at 09:35. Nothing is re-scored here
 * — that would be picking with six and a half hours of hindsight, and the
 * whole point of a record is that the pick precedes the outcome. The only
 * thing this job learns after the fact is the closing price, which is the
 * anchor every forward return is measured from.
 *
 * ## The top five, at the shipped defaults
 *
 * Ordered exactly as the page orders it: names matching every default filter
 * first, then the highest scorers regardless. That is what a reader looking at
 * /scanner this morning actually saw at the top of the table, and a record of
 * something other than what was displayed is not a record of anything.
 *
 * The defaults are used rather than any particular reader's settings for the
 * same reason the archive freezes them: a history recorded at whatever the
 * sliders happened to be set to would be months of incomparable numbers.
 */

/** How many of the day's rows are logged. */
export const LOGGED_PER_DAY = 5;

export interface LogOutcome {
  date: string;
  /** Entries written this run. Empty when the day was already logged. */
  logged: TrackRecordEntry[];
  /** True when this date was already in the record and nothing was written. */
  alreadyLogged: boolean;
  /** Symbols whose closing bar could not be read, kept with a null close. */
  closesMissing: string[];
  notes: string[];
}

export async function logTodaysPicks(): Promise<LogOutcome> {
  const scan = await readTodaysScan();
  const notes: string[] = [];

  if (!scan) {
    return {
      date: config.scanner.scanTimeEt,
      logged: [],
      alreadyLogged: false,
      closesMissing: [],
      notes: [
        'No scan is stored for today, so there is nothing to log. A day the scanner did not run is a day with no picks — it is deliberately not filled in from an earlier session, which would put yesterday’s names in the record under today’s date.',
      ],
    };
  }

  const existing = await trackRecordStore.read().catch(() => ({ entries: [] }));
  if (existing.entries.some((entry) => entry.date === scan.date)) {
    /*
     * Idempotent on purpose, and it re-writes nothing. Both candidate cron
     * times fire and one of them is refused by the schedule guard, but a
     * retried or manually triggered run must not be able to replace a pick
     * that has been sitting in the record for weeks with a different one.
     */
    return {
      date: scan.date,
      logged: [],
      alreadyLogged: true,
      closesMissing: [],
      notes: [
        `${scan.date} is already in the record. Entries are written once and never rewritten — a second run cannot change a pick after the fact.`,
      ],
    };
  }

  const judged = scoreAndJudge(scan.rows, DEFAULT_FILTERS, {
    spyRegime: scan.spyRegime,
  });
  const matching = judged.filter(
    (entry) => entry.passes && !entry.earningsExcluded,
  );
  const matchingSymbols = new Set(matching.map((entry) => entry.row.symbol));
  const ordered = [
    ...matching,
    ...judged.filter((entry) => !matchingSymbols.has(entry.row.symbol)),
  ].slice(0, LOGGED_PER_DAY);

  if (matching.length < ordered.length) {
    notes.push(
      `${ordered.length - matching.length} of the ${ordered.length} logged picks did not match every default filter. They are logged anyway, because they were on the page: the record is of what the scanner showed at the top, not of a subset of it that looked better.`,
    );
  }

  /*
   * One request per symbol, five at most, all in flight together. A failure is
   * kept as a null close rather than dropping the pick: a name whose bar could
   * not be read is still a name the scanner put at the top, and losing it from
   * the record would quietly shrink the sample by exactly the entries the data
   * was worst for.
   */
  const closesMissing: string[] = [];
  const loggedAt = new Date().toISOString();

  const entries = await Promise.all(
    ordered.map(async (scored, index): Promise<TrackRecordEntry> => {
      const { row, score } = scored;

      let close: number | null = null;
      let closeSource = '';

      try {
        const series = await readCloses(row.symbol);
        close = series ? closeOn(series, scan.date) : null;
        closeSource = close !== null
          ? `daily close for ${scan.date}`
          : series
            ? `no daily bar published for ${scan.date} yet when this ran; the settling job fills it in`
            : 'the price source returned no history for this symbol';
      } catch (error) {
        closeSource = `the price request failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (close === null) closesMissing.push(row.symbol);

      const components: Record<string, number | null> = {};
      for (const key of SCORE_KEYS) components[key] = score.components[key];

      return {
        date: scan.date,
        loggedAt,
        symbol: row.symbol,
        rank: index + 1,
        score: score.total,
        components,
        rsRank: row.metrics.rsRank,
        close,
        closeSource,
        forward: {},
      };
    }),
  );

  if (closesMissing.length > 0) {
    notes.push(
      `${closesMissing.length} closing price${closesMissing.length === 1 ? '' : 's'} could not be read: ${closesMissing.join(', ')}. Those picks are in the record with no close and no returns, and the settling job will fill both in when the bar publishes. They are not dropped — dropping them would shrink the sample by exactly the entries the data was worst for.`,
    );
  }

  await trackRecordStore.update((current) => ({
    entries: [...current.entries, ...entries],
  }));

  return {
    date: scan.date,
    logged: entries,
    alreadyLogged: false,
    closesMissing,
    notes,
  };
}
