/**
 * The scanner's track record: what it actually put at the top, and what
 * happened next.
 *
 * ## Why this exists at all
 *
 * Everything else on /scanner is a claim about the present — this name ranks
 * here, on these readings, today. None of it is evidence that the ranking is
 * worth anything. This file and the two jobs that write it are the only part
 * of the site that can ever produce that evidence, and the only honest way to
 * produce it is to write the picks down *before* the outcome is known and then
 * never touch them again.
 *
 * ## The rules this record is kept under
 *
 * 1. **Every logged pick stays.** There is no path in this code that removes
 *    an entry, and no filter anywhere that hides a losing one. A track record
 *    you can filter is a marketing asset, not a record.
 * 2. **Nothing is backfilled.** The series starts on the day the logger first
 *    ran. Reconstructing "what the scanner would have picked" from history
 *    would be inventing picks with knowledge of the outcome, which is the
 *    oldest way to make a bad system look good.
 * 3. **Sample size is stated before anything else.** Under
 *    `HONEST_SAMPLE_SIZE` settled picks the page says outright that nothing
 *    here can be judged yet. That banner is not softened, and it is not
 *    dismissible.
 * 4. **A forward return is not a result.** It is what the close did over one,
 *    three and five trading days from the logged close. Nobody bought
 *    anything, there is no entry, exit, size or cost in it, and the page says
 *    so beside every number.
 *
 * Client-safe: no `server-only`, no imports that pull it in. The page renders
 * these types and the summary is computed from them in the browser.
 */

/** The horizons a forward return is filled in at, in trading days. */
export const HORIZONS = [1, 3, 5] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Key for one horizon inside an entry, e.g. `d5`. */
export type HorizonKey = `d${Horizon}`;

export function horizonKey(days: Horizon): HorizonKey {
  return `d${days}` as HorizonKey;
}

/**
 * How many settled picks it takes before the page stops leading with the
 * sample-size warning.
 *
 * Thirty is a convention rather than a threshold anything real happens at —
 * five weeks of five picks a day is thirty settled *days*, not thirty
 * independent observations, and picks logged on the same morning share a
 * market. The banner says that too. It is set here because a number that
 * appears in one place cannot drift from itself.
 */
export const HONEST_SAMPLE_SIZE = 30;

/** One filled-in forward return. */
export interface ForwardReturn {
  /** Percent change from the logged close. Negative is a loss, and stays. */
  pct: number;
  /** The close it was measured against, and the session it came from. */
  close: number;
  closeDate: string;
}

/**
 * One logged pick.
 *
 * The component breakdown is stored with the entry rather than recomputed
 * later, because the weights and the components can change and the record has
 * to say what the scanner actually thought on the day. A record that updates
 * itself is not a record.
 */
export interface TrackRecordEntry {
  /** New York date the pick was logged, which is the session it belongs to. */
  date: string;
  loggedAt: string;
  symbol: string;
  /** Where it sat in that morning's top five. 1 is the highest scorer. */
  rank: number;
  /** The composite 0-100, frozen. */
  score: number;
  /** Each component's 0-100 on the day, with nulls kept as nulls. */
  components: Record<string, number | null>;
  /** Its position in the whole index by relative strength that morning. */
  rsRank: number;
  /**
   * The close on the logged date, which every forward return is measured from.
   *
   * Null when the closing bar was not published yet when the logger ran. The
   * settling job fills it in on a later pass; until then the entry is on the
   * page with its returns marked pending, because a pick whose price could not
   * be read is still a pick that was made.
   */
  close: number | null;
  /** Where the close came from, or why there is none. Always populated. */
  closeSource: string;
  /**
   * Forward returns by horizon. A missing key is *not yet filled*, which is a
   * different thing from a return of zero and is never rendered as one.
   */
  forward: Partial<Record<HorizonKey, ForwardReturn>>;
}

export interface StoredTrackRecord {
  entries: TrackRecordEntry[];
}

// --- the summary -------------------------------------------------------------

export interface HorizonStats {
  /** Entries with this horizon filled in. */
  sample: number;
  /** Of those, how many came out positive. */
  positive: number;
  /** `positive / sample` as a percentage, or null when nothing is settled. */
  hitRatePct: number | null;
  /** Mean forward return, in percent. Null when nothing is settled. */
  averagePct: number | null;
  /** The best and worst single outcomes, kept whatever they are. */
  best: { symbol: string; date: string; pct: number } | null;
  worst: { symbol: string; date: string; pct: number } | null;
}

export interface TrackRecordSummary {
  /** Every entry ever logged, settled or not. */
  logged: number;
  /** Entries with the five-day return filled in — the headline sample size. */
  settled: number;
  /** True while `settled` is under `HONEST_SAMPLE_SIZE`. */
  tooSmall: boolean;
  /** First and last logged session, or null when the record is empty. */
  from: string | null;
  to: string | null;
  byHorizon: Record<HorizonKey, HorizonStats>;
}

function emptyStats(): HorizonStats {
  return {
    sample: 0,
    positive: 0,
    hitRatePct: null,
    averagePct: null,
    best: null,
    worst: null,
  };
}

/**
 * Summarise the whole record.
 *
 * ## Every entry, always
 *
 * There is deliberately no parameter here — no date range, no minimum score,
 * no "exclude the ones that gapped". The function takes the entries it is
 * given and it is only ever given all of them. Any argument that could narrow
 * this would eventually be used to narrow it.
 *
 * An entry with no five-day return yet is counted in `logged` and not in
 * `settled`. That is the only distinction the summary draws, and it is a
 * distinction about time rather than about outcome: a pick from three days ago
 * has not been excluded, it has not finished.
 */
export function summariseTrackRecord(
  entries: TrackRecordEntry[],
): TrackRecordSummary {
  const dates = entries.map((e) => e.date).sort();

  const byHorizon = {} as Record<HorizonKey, HorizonStats>;

  for (const days of HORIZONS) {
    const key = horizonKey(days);
    const filled = entries
      .map((entry) => ({ entry, forward: entry.forward[key] }))
      .filter(
        (item): item is { entry: TrackRecordEntry; forward: ForwardReturn } =>
          item.forward !== undefined,
      );

    if (filled.length === 0) {
      byHorizon[key] = emptyStats();
      continue;
    }

    const total = filled.reduce((sum, item) => sum + item.forward.pct, 0);
    /*
     * Positive is `> 0`, so an exactly flat close counts as neither a hit nor
     * an omission — it is in the sample and out of the hit count. Rounding a
     * flat outcome up into the hit rate would be a thumb on the scale in the
     * one number most people will read.
     */
    const positive = filled.filter((item) => item.forward.pct > 0).length;

    const sortedByPct = [...filled].sort((a, b) => b.forward.pct - a.forward.pct);
    const bestItem = sortedByPct[0];
    const worstItem = sortedByPct[sortedByPct.length - 1];

    byHorizon[key] = {
      sample: filled.length,
      positive,
      hitRatePct: (positive / filled.length) * 100,
      averagePct: total / filled.length,
      best: {
        symbol: bestItem.entry.symbol,
        date: bestItem.entry.date,
        pct: bestItem.forward.pct,
      },
      worst: {
        symbol: worstItem.entry.symbol,
        date: worstItem.entry.date,
        pct: worstItem.forward.pct,
      },
    };
  }

  const settled = byHorizon.d5.sample;

  return {
    logged: entries.length,
    settled,
    tooSmall: settled < HONEST_SAMPLE_SIZE,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    byHorizon,
  };
}
