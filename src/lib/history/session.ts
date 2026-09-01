import type { BreadthReading } from '../breadth/types';
import type { ConsensusLabel, SectorsSnapshot } from '../sectors/types';

/**
 * One row per trading session: where breadth finished, and where each sector
 * stood.
 *
 * ## Why this series exists at all
 *
 * `breadth.json` and `sectors.json` each hold the CURRENT reading and nothing
 * else. Breadth is explicitly replaced when the New York date changes, and the
 * sectors document is overwritten on every refresh. So the app can say what
 * breadth is, and cannot say what it was — which makes "breadth over time" and
 * "how long has this sector been strong" unanswerable, and makes a
 * what-changed line about either impossible to build honestly.
 *
 * This is a third document that appends instead of replacing. No new data
 * source: every value here is copied from a reading the existing crons already
 * produced.
 *
 * ## The shape is permanent
 *
 * A series cannot be backfilled. Whatever is not recorded on the evening of a
 * session is lost for that session forever, and a field added later starts
 * empty while every earlier row stays blank. So this shape is deliberately a
 * little wider than today's use: `delta1` and the consensus label cost a few
 * bytes each and answer questions the current callers do not ask yet.
 *
 * The corollary is that every field must distinguish three states, not two:
 *
 *   - a real value
 *   - `null`  — the job ran and there was genuinely nothing to record
 *   - absent  — nobody was recording this field yet
 *
 * `null` and absent are different facts and the app has already been burnt
 * once by conflating them: an empty store read as "no names yesterday" and
 * diffed into a cheerful line about arrivals that had been there all along.
 * Readers of this series must treat absent as "cannot answer", never as zero.
 */

export const SESSION_HISTORY_SCHEMA = 1;

/** One sector's standing on one evening. */
export interface SectorHistoryPoint {
  id: string;
  /** Latest average score, 0-100. */
  score: number;
  /** Change against the prior session, as the snapshot itself computed it. */
  delta1: number | null;
  /** The nine-signal consensus, frozen as a word. */
  label: ConsensusLabel;
}

export interface BreadthHistoryPoint {
  /** Share above yesterday's close, 0-100. The headline number. */
  pctAbovePriorClose: number;
  /** Share above their own session average. Null when the sweep had no value. */
  pctAboveSessionAverage: number | null;
  /** Which feed produced the sample this froze. */
  source: 'tradier' | 'yahoo' | null;
  /** When that sample was taken — NOT when this row was written. */
  sampleAt: string;
}

export interface SessionHistoryRow {
  /** New York session date, `YYYY-MM-DD`. The unique key. */
  date: string;
  /** When this row was appended. */
  recordedAt: string;

  /**
   * The session's last breadth sample, or null when the sweep produced none
   * all day. Null is a real answer: it says the job ran and breadth was
   * genuinely unavailable, which is not the same as the row predating breadth
   * being recorded at all.
   */
  breadth: BreadthHistoryPoint | null;

  /** Every sector as the evening's snapshot had it, or null when it had none. */
  sectors: SectorHistoryPoint[] | null;

  /**
   * The date the sectors snapshot itself claims to describe.
   *
   * Stored because the sectors refresh can fail and leave YESTERDAY's document
   * in place, which would otherwise be silently recorded as today's sector
   * state and produce a "moved" line describing a move that never happened.
   * A reader comparing two rows must check this against `date` before trusting
   * the sector half — `sectorsAreCurrent` does exactly that.
   */
  sectorsAsOf: string | null;
}

export interface StoredSessionHistory {
  schema: number;
  /** Newest first. */
  rows: SessionHistoryRow[];
}

/**
 * Sessions kept.
 *
 * Roughly eighteen months. Long enough to answer "how does this compare with
 * last year", and at a few hundred bytes a row still a small document to
 * rewrite inside a function timeout.
 */
export const KEEP_SESSIONS = 400;

/**
 * Freeze one session into a row. Pure, so the shape can be inspected and
 * verified without a store.
 *
 * `breadth` and `sectors` are passed in exactly as the existing readers return
 * them; nothing is fetched here and nothing is recomputed. A missing or broken
 * reading becomes null rather than an omitted field, because this writer DID
 * run — the reader needs to be able to tell that apart from a row written
 * before the field existed.
 */
export function buildSessionRow(input: {
  date: string;
  breadth: BreadthReading | null;
  sectors: SectorsSnapshot | null;
  now?: Date;
}): SessionHistoryRow {
  const { date, breadth, sectors, now = new Date() } = input;

  const sample = breadth?.computed ?? null;

  return {
    date,
    recordedAt: now.toISOString(),
    breadth: sample
      ? {
          pctAbovePriorClose: sample.pctAbovePriorClose,
          pctAboveSessionAverage: sample.pctAboveSessionAverage,
          source: breadth?.source ?? null,
          sampleAt: sample.at,
        }
      : null,
    sectors:
      sectors && sectors.sectors.length > 0
        ? sectors.sectors.map((s) => ({
            id: s.id,
            score: s.score,
            delta1: s.delta1,
            label: s.consensus.label,
          }))
        : null,
    sectorsAsOf: sectors?.asOfDate ?? null,
  };
}

/**
 * True when a row's sector half actually describes that row's session.
 *
 * A row whose `sectorsAsOf` is an older date carries a stale snapshot the
 * refresh failed to update. The values are kept — they are still a true record
 * of what the app was showing that evening — but no comparison may treat them
 * as that session's sector state.
 */
export function sectorsAreCurrent(row: SessionHistoryRow): boolean {
  return row.sectors !== null && row.sectorsAsOf === row.date;
}

/**
 * Insert a row, newest first, replacing any row already held for that date.
 *
 * Replacing rather than refusing makes a re-run idempotent: the evening job
 * can be triggered twice, or retried after a partial failure, without either
 * duplicating the session or leaving the first attempt's emptier row in place.
 */
export function upsertRow(
  current: StoredSessionHistory,
  row: SessionHistoryRow,
): StoredSessionHistory {
  return {
    schema: SESSION_HISTORY_SCHEMA,
    rows: [row, ...current.rows.filter((r) => r.date !== row.date)]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, KEEP_SESSIONS),
  };
}
