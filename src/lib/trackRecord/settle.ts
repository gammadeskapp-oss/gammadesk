import 'server-only';

import { closeAfter, closeOn, readCloses, type CloseSeries } from './closes';
import { trackRecordStore } from './store';
import { HORIZONS, horizonKey, type TrackRecordEntry } from './types';

/**
 * The 16:20 ET job: fill in the forward returns for everything already logged.
 *
 * ## It only ever adds
 *
 * A horizon that is already filled is left exactly as it was, a pick is never
 * removed, and no field other than the missing closes and the missing horizons
 * is touched. That is the whole safety property of this file: a job that runs
 * every weekday against a permanent record has to be incapable of rewriting
 * history, or the record is worth nothing.
 *
 * It is therefore safe to run repeatedly, and safe to run late. An entry whose
 * fifth day has not happened yet is simply not filled in this time; there is
 * no half-filled state and no placeholder that could be mistaken for a return
 * of zero.
 *
 * ## What a forward return is, exactly
 *
 * The percentage change of the daily close, from the session the pick was
 * logged in to the close one, three and five *trading sessions* later.
 * Sessions rather than calendar days, counted off the price series itself, so
 * holidays and weekends take care of themselves.
 *
 * It is not a trade. There is no entry price other than that close, no exit
 * rule, no size, no cost, and nobody bought anything. The page says so beside
 * the numbers, because a column of percentages in a table headed "track
 * record" will otherwise be read as a profit and loss statement.
 */

/**
 * How far back a still-unfilled entry is chased.
 *
 * An entry whose five sessions have passed and whose close still could not be
 * read is not going to be fixed by asking again a month later — the bar it
 * needs either exists by now or the symbol has a problem no retry addresses.
 * Bounding this keeps the job's request count flat as the record grows, which
 * is what lets the record grow forever.
 */
const CHASE_DAYS = 30;

export interface SettleOutcome {
  /** Entries examined this run. */
  considered: number;
  /** Horizons newly filled in. */
  filled: number;
  /** Entries whose anchor close was filled in this run. */
  closesFilled: number;
  /** Symbols whose price request failed; retried next run. */
  failures: string[];
  notes: string[];
}

function daysAgo(date: string, now: Date): number {
  const then = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

/** True when this entry still has something a later run could add. */
function outstanding(entry: TrackRecordEntry, now: Date): boolean {
  if (daysAgo(entry.date, now) > CHASE_DAYS) return false;
  if (entry.close === null) return true;
  return HORIZONS.some((days) => entry.forward[horizonKey(days)] === undefined);
}

export async function settleTrackRecord(
  now: Date = new Date(),
): Promise<SettleOutcome> {
  const stored = await trackRecordStore.read().catch(() => null);
  const entries = stored?.entries ?? [];

  const pending = entries.filter((entry) => outstanding(entry, now));

  if (pending.length === 0) {
    return {
      considered: 0,
      filled: 0,
      closesFilled: 0,
      failures: [],
      notes: [
        'Nothing outstanding. Every logged pick inside the chase window already has its close and all three forward returns.',
      ],
    };
  }

  /*
   * One price request per distinct symbol, not per entry. The same name at the
   * top of the list on three consecutive mornings is three entries and one
   * series.
   */
  const symbols = [...new Set(pending.map((entry) => entry.symbol))];
  const series = new Map<string, CloseSeries>();
  const failures: string[] = [];

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const closes = await readCloses(symbol);
        if (closes) series.set(symbol, closes);
        else failures.push(symbol);
      } catch {
        // Retried on the next run. Deliberately not recorded in the entry: a
        // failed request is a fact about this evening's network, not about the
        // pick, and writing it into a permanent record would make it look like
        // one.
        failures.push(symbol);
      }
    }),
  );

  let filled = 0;
  let closesFilled = 0;
  const pendingKeys = new Set(pending.map((entry) => `${entry.date}:${entry.symbol}`));

  await trackRecordStore.update((current) => ({
    entries: current.entries.map((entry) => {
      if (!pendingKeys.has(`${entry.date}:${entry.symbol}`)) return entry;

      const closes = series.get(entry.symbol);
      if (!closes) return entry;

      /*
       * The anchor close first. Everything else is measured from it, so an
       * entry the logging job could not price stays unsettled until this fills
       * it in — rather than being measured from some other day's close, which
       * would produce a plausible number that means nothing.
       */
      let anchor = entry.close;
      let closeSource = entry.closeSource;
      if (anchor === null) {
        anchor = closeOn(closes, entry.date);
        if (anchor !== null) {
          closesFilled += 1;
          closeSource = `daily close for ${entry.date}, filled in after the fact`;
        }
      }
      if (anchor === null) return { ...entry, closeSource };

      const forward = { ...entry.forward };

      for (const days of HORIZONS) {
        const key = horizonKey(days);
        // Never recomputed. A filled horizon is finished, whatever it says.
        if (forward[key] !== undefined) continue;

        const future = closeAfter(closes, entry.date, days);
        if (!future) continue;

        forward[key] = {
          pct: ((future.close - anchor) / anchor) * 100,
          close: future.close,
          closeDate: future.date,
        };
        filled += 1;
      }

      return { ...entry, close: anchor, closeSource, forward };
    }),
  }));

  const notes: string[] = [];
  if (failures.length > 0) {
    notes.push(
      `${failures.length} price request${failures.length === 1 ? '' : 's'} did not answer: ${failures.join(', ')}. Those entries keep whatever they already had and are retried on the next run, for up to ${CHASE_DAYS} days from the pick. Nothing was written for them — an unfilled return is left unfilled rather than guessed.`,
    );
  }

  return {
    considered: pending.length,
    filled,
    closesFilled,
    failures,
    notes,
  };
}
