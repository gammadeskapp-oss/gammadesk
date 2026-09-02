/**
 * What the channel has already been told, and what it should be told next.
 *
 * ## Why this is separate from the alarm that uses it
 *
 * `cronAlarm.ts` reads Blob storage and talks to Discord, so it cannot run
 * outside a request. The decisions it makes — is this new, is it time to
 * repeat, has it recovered — are pure, and they are the part with a state
 * machine in it. Kept here they can be driven at synthetic instants by
 * `scripts/verify-cron-alarm.mjs`, which is the only practical way to check
 * that the six-hour repeat actually repeats at six hours and not five.
 *
 * ## The three rules
 *
 *   1. A source that goes late is announced once, immediately.
 *   2. While it stays late it is repeated every `REALERT_HOURS`, so a job that
 *      is still down tomorrow does not go quiet and get forgotten.
 *   3. When it comes back that is announced too, and the entry is dropped.
 *
 * Rule 3 is not politeness. Without it a source that recovers keeps its entry,
 * and the next time it fails it looks like an ongoing incident rather than a
 * new one — the channel would be told "still down after 4 days" about a job
 * that broke ten minutes ago.
 */

/** Re-alert cadence while a source stays late. */
export const REALERT_HOURS = 6;

export interface AlarmEntry {
  /** When this source was first seen late, ISO. */
  since: string;
  /** When the channel was last told about it, ISO. */
  lastAlertedAt: string;
}

/** Keyed by cron path. An absent key means the source is believed healthy. */
export type OpenAlarms = Record<string, AlarmEntry>;

/** One source's grade, reduced to what the state machine needs. */
export interface Graded {
  path: string;
  late: boolean;
}

export interface AlarmDiff<T extends Graded> {
  /** Newly late: announce now. */
  opened: T[];
  /** Still late and the cadence came round: repeat. */
  repeated: T[];
  /** Still late but inside the window: deliberately silent. */
  suppressed: string[];
  /** Came back: announce the recovery and drop the entry. */
  recovered: T[];
}

export function diffAlarmState<T extends Graded>(
  graded: T[],
  open: OpenAlarms,
  now: Date,
): AlarmDiff<T> {
  const realertMs = REALERT_HOURS * 3_600_000;
  const diff: AlarmDiff<T> = {
    opened: [],
    repeated: [],
    suppressed: [],
    recovered: [],
  };

  for (const g of graded) {
    const existing = open[g.path];

    if (g.late) {
      if (!existing) {
        diff.opened.push(g);
        continue;
      }
      /*
       * An unparseable `lastAlertedAt` repeats rather than suppressing. The
       * two ways to be wrong here are "said it twice" and "went silent about a
       * dead job", and only one of them is recoverable by the reader.
       */
      const since = Date.parse(existing.lastAlertedAt);
      if (!Number.isFinite(since) || now.getTime() - since >= realertMs) {
        diff.repeated.push(g);
      } else {
        diff.suppressed.push(g.path);
      }
    } else if (existing) {
      diff.recovered.push(g);
    }
  }

  return diff;
}

/**
 * The state to store after a delivered message.
 *
 * Returns a new object rather than mutating: the caller must be able to decide
 * not to save it — a failed webhook that still recorded "we told them" would
 * turn one dropped request into permanent silence.
 */
export function applyAlarmDiff<T extends Graded>(
  open: OpenAlarms,
  diff: AlarmDiff<T>,
  now: Date,
): OpenAlarms {
  const next: OpenAlarms = { ...open };
  const stamp = now.toISOString();

  for (const g of diff.opened) {
    next[g.path] = { since: stamp, lastAlertedAt: stamp };
  }
  for (const g of diff.repeated) {
    // `since` is preserved, because "still down after 14h" is the useful half
    // of a repeat and it is lost the moment the first-seen time is overwritten.
    next[g.path] = { since: next[g.path]?.since ?? stamp, lastAlertedAt: stamp };
  }
  for (const g of diff.recovered) {
    delete next[g.path];
  }

  return next;
}
