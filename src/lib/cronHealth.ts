import 'server-only';

import { peekBreadthDoc } from './breadth/store';
import { readDigests } from './digest';
import { peekStoredFlow } from './flow';
import { peekStoredGroups } from './groups';
import { readLog } from './log/store';
import { readPosts } from './post';
import { peekRetestDoc } from './retest/store';
import { peekRsMeta } from './rs';
import { peekScannerGamma, readLatestScan } from './scanner';
import { readTrackRecord } from './trackRecord/store';
import { peekStoredSectors } from './sectors';
import { ageHours } from './staleness';
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

export interface CronHealth {
  checkedAt: string;
  sources: CronSource[];
  /** Count of anything not `ok`. */
  problemCount: number;
}

export async function readCronHealth(now: Date = new Date()): Promise<CronHealth> {
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
    trackRecord,
    posts,
    log,
    groups,
    sectors,
    digests,
    flow,
    velocity,
    rsMeta,
  ] = await Promise.all([
    peekBreadthDoc().catch(() => null),
    peekRetestDoc().catch(() => null),
    peekScannerGamma().catch(() => null),
    readLatestScan().catch(() => null),
    readTrackRecord().catch(() => []),
    readPosts().catch(() => []),
    readLog().catch(() => []),
    peekStoredGroups().catch(() => null),
    peekStoredSectors().catch(() => null),
    readDigests().catch(() => []),
    peekStoredFlow().catch(() => null),
    peekVelocity().catch(() => null),
    peekRsMeta().catch(() => null),
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
  /** Picks whose five-day return has been filled in — the headline sample. */
  const settledPicks = trackRecord.filter((entry) => entry.forward.d5 !== undefined);

  const defs: Array<Omit<CronSource, 'ageHours' | 'state'>> = [
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
      detail: breadth ? `${breadth.samples.length} samples on ${breadth.date}` : null,
    },
    {
      path: '/api/retest/refresh',
      label: 'Broken-level retests',
      schedule: 'every minute, 13:00-21:59 UTC, Mon-Fri',
      lastSuccess: retests?.updatedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: retests ? `${retests.events.length} events on ${retests.date}` : null,
    },
    {
      path: '/api/scanner/gamma',
      label: 'Scanner gamma readings',
      schedule: '12:30 and 13:30 UTC, Mon-Fri',
      lastSuccess: gamma?.refreshedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
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
      detail: scan ? `${scan.rows.length} rows on ${scan.date}` : null,
    },
    {
      path: '/api/trackrecord/log',
      label: 'Scanner track record - logging',
      schedule: '20:15 and 21:15 UTC, Mon-Fri',
      lastSuccess: trackRecord[0]?.loggedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail:
        trackRecord.length > 0
          ? `${trackRecord.length} picks logged, latest ${trackRecord[0].date}`
          : 'nothing logged yet - the record starts the first evening this runs, and is never backfilled',
    },
    {
      path: '/api/trackrecord/settle',
      label: 'Scanner track record - forward returns',
      schedule: '20:20 and 21:20 UTC, Mon-Fri',
      /*
       * Settling writes no stamp of its own, so the newest *settled* pick's
       * logging time stands in and is labelled as approximate. A borrowed
       * timestamp shown without the caveat would report this job healthy on a
       * day it never ran — the same trap `/api/log/settle` documents below.
       */
      lastSuccess: settledPicks[0]?.loggedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: `${settledPicks.length} of ${trackRecord.length} picks settled at 5 days - dated from the pick, not the settle run`,
    },
    {
      path: '/api/post',
      label: 'Morning post',
      schedule: '13:00 UTC, Mon-Fri',
      lastSuccess: posts[0]?.generatedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: posts[0] ? `latest for ${posts[0].date}` : null,
    },
    {
      path: '/api/log/snapshot',
      label: 'Accuracy log - morning snapshot',
      schedule: '14:45 UTC, Mon-Fri',
      lastSuccess: log[0]?.snapshotAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
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
      detail: `${settled.length} settled, ${log.length - settled.length} awaiting - dated from the snapshot, not the settle run`,
    },
    {
      path: '/api/flow/refresh',
      label: 'Unusual options flow',
      schedule: '21:40 UTC, Mon-Fri',
      lastSuccess: flow?.computedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: flow ? `${flow.rows.length} rows` : null,
    },
    {
      path: '/api/velocity/refresh',
      label: 'Positioning velocity',
      schedule: '21:50 UTC, Mon-Fri',
      lastSuccess: velocity?.capturedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: velocity ? `chain dated ${velocity.date}` : null,
    },
    {
      path: '/api/groups/refresh',
      label: 'Group rankings',
      schedule: '22:00 UTC, Mon-Fri',
      lastSuccess: groups?.computedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: groups ? `${groups.groups.length} groups` : null,
    },
    {
      path: '/api/sectors/refresh',
      label: 'Sector breakdown',
      schedule: '22:10 UTC, Mon-Fri',
      lastSuccess: sectors?.computedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: null,
    },
    {
      path: '/api/digest',
      label: 'Daily digest',
      schedule: '22:20 UTC, Mon-Fri',
      lastSuccess: digests[0]?.generatedAt ?? null,
      staleAfterHours: WEEKEND_SLACK_HOURS,
      detail: digests[0] ? `latest for ${digests[0].date}` : null,
    },
    {
      path: '/api/rs/refresh',
      label: 'Relative strength (sharded)',
      schedule: '23:00, 01:00, 03:00 and 05:00 UTC',
      lastSuccess: rsLast,
      staleAfterHours: WEEKEND_SLACK_HOURS,
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
      detail: 'shares the RS refresh stamp; no separate timestamp is recorded',
    },
  ];

  const sources: CronSource[] = defs.map((d) => ({
    ...d,
    ...grade(d.lastSuccess, d.staleAfterHours, now),
  }));

  return {
    checkedAt: now.toISOString(),
    sources,
    problemCount: sources.filter((s) => s.state !== 'ok').length,
  };
}
