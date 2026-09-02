import 'server-only';

import { describeDue, lastDueInstant, type Due } from './cronDue';
import { marketSessionRules } from './events';
import type { SessionRules } from './events/rules';
import { peekBreadthDoc } from './breadth/store';
import { lastGoodSnapshotStatus } from './lastSnapshot';
import { readDigests } from './digest';
import { peekStoredFlow } from './flow';
import { peekStoredGroups } from './groups';
import { readLog } from './log/store';
import { readPosts } from './post';
import { peekRetestDoc } from './retest/store';
import { peekRsMeta } from './rs';
import { peekScannerGamma, readLatestScan } from './scanner';
import { peekStoredSectors } from './sectors';
import { ageHours } from './staleness';
import { formatAsOf } from './time';
import { peekVelocity } from './velocity';

/**
 * One reading per scheduled job: when it last wrote something, and whether
 * that is late.
 *
 * ## Why this lives apart from the route that serves it
 *
 * `/api/health` and `/status` answer the same question for two different
 * readers — a machine and a person. Built separately they would drift, and the
 * failure mode is specific and bad: the JSON says a job is late while the page
 * a human actually opens says everything is green. One source, two renderers.
 *
 * ## Every read here is a peek
 *
 * Nothing in this file computes, fetches upstream, or triggers a refresh. It
 * reads what each job already wrote. That matters because a status page people
 * reload when they are worried must not itself cost quota, and because a check
 * that repairs the thing it is checking cannot report on it honestly.
 */

export type CronState = 'ok' | 'late' | 'missing';

/**
 * The alarm's verdict for one source.
 *
 * `not-due` is separate from `ok` on purpose: "it wrote after its last due
 * instant" and "it has not been due yet today" are both fine, but only the
 * first is evidence the job works. Collapsing them would let a job that has
 * never run once read as healthy all weekend.
 *
 * `not-alarmed` is the positioning row — tracked here, never paged about.
 */
export type DueState = 'ok' | 'late' | 'missing' | 'not-due' | 'not-alarmed';

/**
 * How each job's schedule repeats, for the alarm to grade against. The type
 * and the arithmetic live in `cronDue.ts` — see the note there for why they
 * are kept out of this server-only module.
 */
export type { Due } from './cronDue';

export interface CronSource {
  /** The scheduled route, matching vercel.json. */
  path: string;
  /** What it produces, in words. */
  label: string;
  /** The cron expression(s) from vercel.json, for the page to show. */
  schedule: string;
  /** ISO timestamp of the last successful write, or null. */
  lastSuccess: string | null;
  /** Age of that write in hours, one decimal. Null when nothing is stored. */
  ageHours: number | null;
  /**
   * Age past which the job counts as late.
   *
   * Set from the schedule with room for a weekend: a job that runs at 22:00 on
   * weekdays has not failed at 09:00 on a Sunday, it simply has not been due
   * since Friday. Getting this wrong in the tight direction means a status
   * page that is red every weekend, which is the same as a status page nobody
   * reads.
   */
  staleAfterHours: number;
  /**
   * The job's own schedule, in terms the alarm can reason about. Kept beside
   * the cron expression rather than parsed out of it: `schedule` is prose for
   * a human to read, and deriving an alarm from prose is how an alarm ends up
   * quietly wrong.
   */
  due: Due;
  /**
   * Grace after the due instant before the alarm counts the job as missing,
   * in minutes. Covers scheduler delay plus however long the job runs.
   *
   * Sized generously rather than tightly. The cost of too much grace is
   * noticing a dead job an hour later than possible; the cost of too little is
   * an alarm that fires on jobs that ran fine, which ends with the channel
   * muted and nobody noticing anything at all.
   */
  graceMinutes: number;
  /**
   * Whether the Discord alarm may page about this source.
   *
   * True for everything Vercel actually schedules. False for a source that is
   * tracked here but not driven by a cron, where "late" is a fact worth
   * showing a human on /status and not a fact worth waking someone for.
   */
  alarms: boolean;
  /**
   * The `state` above, restated as the alarm sees it.
   *
   * Two gradings exist because they answer different questions, and both are
   * shown rather than one being picked for the reader. `state` is the flat age
   * limit — loose, weekend-proof, and the right thing for a page someone opens
   * on a Sunday. `dueState` is the alarm's: measured against the last instant
   * this job was actually due.
   *
   * They can legitimately disagree, and the disagreement is informative. A job
   * that missed this morning's run is `ok` by age and `late` by due — which is
   * exactly the case that used to be invisible. Showing only one would hide
   * either the real miss or the reason a page is warning.
   */
  dueState: DueState;
  /** The instant it should have written by, ISO. Null when not yet due. */
  dueBy: string | null;
  /** The `due` descriptor in words, e.g. "every trading day at 09:00 ET". */
  dueLabel: string;
  /** One sentence saying how `dueState` was reached. */
  grading: string;
  state: CronState;
  /** Anything worth saying beyond the timestamp. */
  detail: string | null;
}

/** Weekday-only jobs need to survive a long weekend before they count as late. */
const WEEKEND_SLACK_HOURS = 72;

function grade(
  lastSuccess: string | null,
  staleAfterHours: number,
  now: Date,
): { ageHours: number | null; state: CronState } {
  const age = ageHours(lastSuccess, now);
  if (age === null) return { ageHours: null, state: 'missing' };
  return { ageHours: age, state: age > staleAfterHours ? 'late' : 'ok' };
}

/**
 * Grade one source the way the alarm does: against the last instant it was
 * due, rather than against a flat age.
 *
 * The `grading` sentence is written here rather than in the page, because it
 * is the explanation of a decision this function made. A renderer composing
 * its own sentence from the fields would be restating the logic in a second
 * place, and the two would eventually say different things about the same row
 * — which on a status page is worse than saying nothing.
 */
function gradeByDue(
  source: Omit<CronSource, 'ageHours' | 'state' | 'dueState' | 'dueBy' | 'dueLabel' | 'grading'>,
  now: Date,
  rules: SessionRules,
): Pick<CronSource, 'dueState' | 'dueBy' | 'dueLabel' | 'grading'> {
  const dueLabel = describeDue(source.due);

  if (!source.alarms) {
    return {
      dueState: 'not-alarmed',
      dueBy: null,
      dueLabel,
      grading: 'Tracked but never alarmed on — nothing schedules it.',
    };
  }

  const dueMs = lastDueInstant(source.due, source.graceMinutes, now, rules);

  if (dueMs === null) {
    return {
      dueState: 'not-due',
      dueBy: null,
      dueLabel,
      grading: `Runs ${dueLabel}; it has not come due yet, so there is nothing to judge.`,
    };
  }

  const dueBy = new Date(dueMs).toISOString();
  const dueStamp = formatAsOf(new Date(dueMs));
  const graceNote =
    source.graceMinutes > 0
      ? ` (+${source.graceMinutes}m grace)`
      : '';

  const wrote = source.lastSuccess ? Date.parse(source.lastSuccess) : NaN;

  if (!Number.isFinite(wrote)) {
    return {
      dueState: 'missing',
      dueBy,
      dueLabel,
      grading: `Runs ${dueLabel}. Due by ${dueStamp}${graceNote}; nothing has ever been written.`,
    };
  }

  if (wrote >= dueMs) {
    return {
      dueState: 'ok',
      dueBy,
      dueLabel,
      grading: `Runs ${dueLabel}. Due by ${dueStamp}${graceNote}; wrote ${formatAsOf(new Date(wrote))}.`,
    };
  }

  const behindH = (dueMs - wrote) / 3_600_000;
  return {
    dueState: 'late',
    dueBy,
    dueLabel,
    grading: `Runs ${dueLabel}. Due by ${dueStamp}${graceNote}; last wrote ${formatAsOf(
      new Date(wrote),
    )} — ${behindH.toFixed(1)}h before it was due.`,
  };
}

export interface CronHealth {
  checkedAt: string;
  sources: CronSource[];
  /** Count of anything not `ok`. */
  problemCount: number;
}

export async function readCronHealth(
  now: Date = new Date(),
  rules: SessionRules = marketSessionRules(),
): Promise<CronHealth> {
  /*
   * All in parallel and each allowed to fail on its own. A status page that
   * fails outright because one store is unreachable is useless at exactly the
   * moment it is needed.
   */
  const [
    breadth,
    retests,
    gamma,
    scan,
    posts,
    log,
    groups,
    sectors,
    digests,
    flow,
    velocity,
    rsMeta,
    positioning,
  ] = await Promise.all([
    peekBreadthDoc().catch(() => null),
    peekRetestDoc().catch(() => null),
    peekScannerGamma().catch(() => null),
    readLatestScan().catch(() => null),
    readPosts().catch(() => []),
    readLog().catch(() => []),
    peekStoredGroups().catch(() => null),
    peekStoredSectors().catch(() => null),
    readDigests().catch(() => []),
    peekStoredFlow().catch(() => null),
    peekVelocity().catch(() => null),
    peekRsMeta().catch(() => null),
    lastGoodSnapshotStatus().catch(() => null),
  ]);

  /*
   * The RS refresh works a shard at a time across four nightly runs, so
   * "when did it last run" is the newest of the per-shard stamps rather than a
   * single field.
   */
  const rsRanAt = Object.values(rsMeta?.ranAt ?? {})
    .filter((v): v is string => typeof v === 'string')
    .sort();
  const rsLast = rsRanAt.length > 0 ? rsRanAt[rsRanAt.length - 1] : null;

  const settled = log.filter((e) => e.settled);

  const defs: Array<
    Omit<CronSource, 'ageHours' | 'state' | 'dueState' | 'dueBy' | 'dueLabel' | 'grading'>
  > = [
    {
      path: '/api/breadth/refresh',
      label: 'Market breadth (S&P 500 advancers and decliners)',
      schedule: 'every minute, 13:00-21:59 UTC, Mon-Fri',
      /*
       * An empty breadth document is stamped with the current time by its own
       * `empty()` fallback, so a store that has never been written reads back
       * as written a moment ago. Requiring at least one sample is what stops
       * "no data at all" from showing up here as the greenest row on the page.
       */
      lastSuccess:
        breadth && breadth.samples.length > 0 ? breadth.updatedAt : null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'continuous' },
      graceMinutes: 15,
      alarms: true,
      detail: breadth ? `${breadth.samples.length} samples on ${breadth.date}` : null,
    },
    {
      path: '/api/retest/refresh',
      label: 'Broken-level retests',
      schedule: 'every minute, 13:00-21:59 UTC, Mon-Fri',
      lastSuccess: retests?.updatedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'continuous' },
      graceMinutes: 15,
      alarms: true,
      detail: retests ? `${retests.events.length} events on ${retests.date}` : null,
    },
    {
      path: '/api/scanner/gamma',
      label: 'Scanner gamma readings',
      schedule: '12:30 and 13:30 UTC, Mon-Fri',
      lastSuccess: gamma?.refreshedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '08:30' },
      graceMinutes: 90,
      alarms: true,
      detail: gamma
        ? `${Object.keys(gamma.symbols).length} symbols on ${gamma.date}`
        : null,
    },
    {
      path: '/api/scanner/run',
      label: 'Scanner run',
      schedule: '13:35 and 14:35 UTC, Mon-Fri',
      lastSuccess: scan?.scannedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '09:35' },
      graceMinutes: 90,
      alarms: true,
      detail: scan ? `${scan.rows.length} rows on ${scan.date}` : null,
    },
    {
      path: '/api/post',
      label: 'Morning post',
      schedule: '13:00 UTC, Mon-Fri',
      lastSuccess: posts[0]?.generatedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '09:00' },
      graceMinutes: 90,
      alarms: true,
      detail: posts[0] ? `latest for ${posts[0].date}` : null,
    },
    {
      path: '/api/log/snapshot',
      label: 'Accuracy log - morning snapshot',
      schedule: '14:45 UTC, Mon-Fri',
      lastSuccess: log[0]?.snapshotAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '10:45' },
      graceMinutes: 90,
      alarms: true,
      detail: log.length > 0 ? `${log.length} records, latest ${log[0].date}` : null,
    },
    {
      path: '/api/log/settle',
      label: 'Accuracy log - settlement',
      schedule: '21:15 UTC, Mon-Fri',
      /*
       * Settlement records no stamp of its own, so the newest settled entry's
       * snapshot time stands in. That is approximate, and it is labelled as
       * approximate rather than presented as a reading — a borrowed timestamp
       * shown without the caveat would report this job as healthy on a day it
       * never ran at all.
       */
      lastSuccess: settled[0]?.snapshotAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '17:15' },
      graceMinutes: 120,
      alarms: true,
      detail: `${settled.length} settled, ${log.length - settled.length} awaiting - dated from the snapshot, not the settle run`,
    },
    {
      path: '/api/flow/refresh',
      label: 'Unusual options flow',
      schedule: '21:40 UTC, Mon-Fri',
      lastSuccess: flow?.computedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '17:40' },
      graceMinutes: 120,
      alarms: true,
      detail: flow ? `${flow.rows.length} rows` : null,
    },
    {
      path: '/api/velocity/refresh',
      label: 'Positioning velocity',
      schedule: '21:50 UTC, Mon-Fri',
      lastSuccess: velocity?.capturedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '17:50' },
      graceMinutes: 120,
      alarms: true,
      detail: velocity ? `chain dated ${velocity.date}` : null,
    },
    {
      path: '/api/groups/refresh',
      label: 'Group rankings',
      schedule: '22:00 UTC, Mon-Fri',
      lastSuccess: groups?.computedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '18:00' },
      graceMinutes: 120,
      alarms: true,
      detail: groups ? `${groups.groups.length} groups` : null,
    },
    {
      path: '/api/sectors/refresh',
      label: 'Sector breakdown',
      schedule: '22:10 UTC, Mon-Fri',
      lastSuccess: sectors?.computedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '18:10' },
      graceMinutes: 120,
      alarms: true,
      detail: null,
    },
    {
      path: '/api/digest',
      label: 'Daily digest',
      schedule: '22:20 UTC, Mon-Fri',
      lastSuccess: digests[0]?.generatedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '18:20' },
      graceMinutes: 120,
      alarms: true,
      detail: digests[0] ? `latest for ${digests[0].date}` : null,
    },
    {
      path: '/api/rs/refresh',
      label: 'Relative strength (sharded)',
      schedule: '23:00, 01:00, 03:00 and 05:00 UTC',
      lastSuccess: rsLast,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'daily', atEt: '19:00' },
      graceMinutes: 480,
      alarms: true,
      detail: rsMeta
        ? `${rsRanAt.length} shards recorded, cursor at ${rsMeta.cursor}`
        : null,
    },
    {
      path: '/api/rs/members',
      label: 'S&P 500 membership refresh',
      schedule: '22:30 UTC, Saturdays',
      lastSuccess: rsLast,
      /*
       * Weekly, so a fortnight of slack. It borrows the RS refresh stamp
       * because membership records none of its own; said plainly in the detail
       * rather than left to look like a precise reading.
       */
      staleAfterHours: 14 * 24,
      due: { kind: 'weekly', weekday: 6, atEt: '18:30' },
      graceMinutes: 1440,
      alarms: true,
      detail: 'shares the RS refresh stamp; no separate timestamp is recorded',
    },
    {
      /*
       * Not a cron at all, and that is the finding.
       *
       * Every other row here is written by a scheduled job. The positioning
       * snapshot — the chain behind /decision, /forecast and the front page —
       * is written by `saveLastGoodSnapshot`, which runs only as a side effect
       * of a page request that fetched successfully. Nothing refreshes it on a
       * schedule, so its age is "when a human last opened the site while the
       * feed was up".
       *
       * That made it the stalest data on the site and the only dataset with no
       * row on this page, which is the worst pairing available: the check that
       * exists to find stale data was blind to the one source most likely to
       * be stale. It is listed now.
       *
       * `alarms: false` because the alarm would otherwise fire on any quiet
       * afternoon and be telling the truth about a job that does not exist.
       * A human reading /status gets the caveat in `detail`; nobody gets paged
       * for it. Giving it a real refresh cron is a separate decision, with
       * upstream quota attached.
       */
      path: '/api/positioning',
      label: 'Options positioning snapshot (no cron — written by page traffic)',
      schedule: 'not scheduled; written on a successful page fetch',
      lastSuccess: positioning?.savedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      due: { kind: 'continuous' },
      graceMinutes: 60,
      alarms: false,
      detail:
        'No cron writes this. It refreshes only when someone loads a page and the Cboe fetch succeeds, so a quiet day looks identical to a broken feed here.',
    },
  ];

  const sources: CronSource[] = defs.map((d) => ({
    ...d,
    ...grade(d.lastSuccess, d.staleAfterHours, now),
    ...gradeByDue(d, now, rules),
  }));

  return {
    checkedAt: now.toISOString(),
    sources,
    problemCount: sources.filter((s) => s.state !== 'ok').length,
  };
}
