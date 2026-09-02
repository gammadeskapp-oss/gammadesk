import 'server-only';

import { readCronHealth, type CronSource } from './cronHealth';
import { sendToDiscord, discordConfigured, type Delivery } from './discord';
import type { SessionRules } from './events/rules';
import {
  applyAlarmDiff,
  diffAlarmState,
  REALERT_HOURS,
  type OpenAlarms,
} from './cronAlarmState';
import { createJsonStore } from './jsonStore';
import { marketNow } from './time';

/**
 * The job-level alarm.
 *
 * ## Why this exists
 *
 * `/api/health` and `/status` have known which jobs are late for as long as
 * they have existed, and both are pull-only. Finding out that the breadth feed
 * died on Monday required someone to open a page and read it — which is how a
 * multi-day gap gets discovered by noticing that a number on an unrelated
 * screen looks wrong. This pushes.
 *
 * ## Why "late" is measured against the due instant, not the clock
 *
 * See the `Due` note in `cronHealth.ts`. The short version: a flat age limit
 * cannot separate a dead job from a Monday morning, and an alarm that fires
 * every Monday is an alarm that gets muted.
 *
 * ## Why it only runs during market hours
 *
 * Not for quiet's sake — because a late job is only actionable while there is
 * a session left to salvage. A 21:00 page about the morning scan cannot be
 * acted on until tomorrow, by which time the morning check says the same thing.
 */

export { REALERT_HOURS };

interface AlarmState {
  open: OpenAlarms;
}

const store = createJsonStore<AlarmState>(
  'gammadesk/cron-alarm.json',
  () => ({ open: {} }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const open = (raw as { open?: unknown }).open;
    if (!open || typeof open !== 'object') return { open: {} };
    return { open: open as OpenAlarms };
  },
);

/** `HH:MM` of an instant on the New York clock. */
function etClock(ms: number): string {
  const c = marketNow(new Date(ms));
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

export interface AlarmVerdict {
  /** The cron path, duplicated from `source` so this satisfies `Graded`. */
  path: string;
  source: CronSource;
  late: boolean;
  /** The instant it should have written by, ISO. Null when not yet due. */
  dueBy: string | null;
  /** Plain-language reason, used verbatim in the Discord line. */
  reason: string;
}

/**
 * Reduce the health reading to what the state machine needs.
 *
 * The grading itself happens in `cronHealth.gradeByDue`, not here. That is
 * deliberate and it is the same rule the top of `cronHealth.ts` states about
 * `/api/health` and `/status`: one source, several renderers. An alarm that
 * decided "late" by its own arithmetic could page about a job that /status was
 * showing as green, and a reader with a red channel and a green page has no
 * way to tell which one is lying.
 */
export function gradeForAlarm(sources: CronSource[]): AlarmVerdict[] {
  return sources
    .filter((s) => s.alarms)
    .map((source) => ({
      path: source.path,
      source,
      late: source.dueState === 'late' || source.dueState === 'missing',
      dueBy: source.dueBy,
      reason:
        source.dueState === 'missing'
          ? 'has never written anything'
          : source.dueState === 'late'
            ? `last wrote ${
                source.ageHours === null ? 'never' : `${source.ageHours.toFixed(1)}h ago`
              }, due by ${etClock(Date.parse(source.dueBy ?? ''))} ET`
            : source.grading,
    }));
}

export interface AlarmRun {
  /** Whether anything was actually delivered. */
  posted: boolean;
  delivery: Delivery | null;
  /** Sources newly late this run. */
  opened: string[];
  /** Sources still late, re-alerted because the cadence came round. */
  repeated: string[];
  /** Still late but inside the re-alert window, deliberately silent. */
  suppressed: string[];
  /** Sources that came back. */
  recovered: string[];
  message: string | null;
}

/**
 * One pass: grade, diff against what the channel has already been told, post
 * the difference, remember.
 *
 * The state write happens only after a successful send. A failed webhook that
 * still recorded "we told them" would turn one dropped request into permanent
 * silence about a dead job — precisely the failure this exists to prevent.
 */
export async function runCronAlarm(
  now: Date,
  rules: SessionRules,
  options: { dry?: boolean } = {},
): Promise<AlarmRun> {
  const health = await readCronHealth(now, rules);
  const verdicts = gradeForAlarm(health.sources);

  const state = await store.read().catch(() => ({ open: {} }) as AlarmState);
  const open = state.open;

  const diff = diffAlarmState(verdicts, open, now);
  const { opened, repeated, suppressed, recovered } = diff;

  const nothingToSay =
    opened.length === 0 && repeated.length === 0 && recovered.length === 0;

  if (nothingToSay) {
    return {
      posted: false,
      delivery: null,
      opened: [],
      repeated: [],
      suppressed,
      recovered: [],
      message: null,
    };
  }

  const message = buildAlarmMessage(opened, repeated, recovered, open, now);

  if (options.dry) {
    return {
      posted: false,
      delivery: { delivered: false, reason: 'Dry run — nothing was posted.' },
      opened: opened.map((v) => v.source.path),
      repeated: repeated.map((v) => v.source.path),
      suppressed,
      recovered: recovered.map((v) => v.source.path),
      message,
    };
  }

  const delivery = discordConfigured()
    ? await sendToDiscord(message)
    : { delivered: false, reason: 'DISCORD_WEBHOOK_URL is not set.' };

  if (delivery.delivered) {
    await store.write({ open: applyAlarmDiff(open, diff, now) }).catch(() => {
      // Swallowed on purpose. A storage failure here costs a duplicate alert
      // next run, which is much cheaper than dropping a delivered alarm.
    });
  }

  return {
    posted: delivery.delivered,
    delivery,
    opened: opened.map((v) => v.source.path),
    repeated: repeated.map((v) => v.source.path),
    suppressed,
    recovered: recovered.map((v) => v.source.path),
    message,
  };
}

/** How long a source has been down, in words. */
function downFor(since: string, now: Date): string {
  const h = (now.getTime() - Date.parse(since)) / 3_600_000;
  if (!Number.isFinite(h)) return 'an unknown time';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * The channel message.
 *
 * Every line names the path, so the reader can act without opening anything;
 * the label follows for whoever does not have the routes memorised. Recoveries
 * share the message rather than getting their own post — a job that flapped
 * twice in one window should read as one event, not four.
 */
export function buildAlarmMessage(
  opened: AlarmVerdict[],
  repeated: AlarmVerdict[],
  recovered: AlarmVerdict[],
  open: OpenAlarms,
  now: Date,
): string {
  const down = opened.length + repeated.length;
  const lines: string[] = [
    down > 0
      ? `**Scheduled jobs not writing — ${down} ${down === 1 ? 'job' : 'jobs'}**`
      : '**Scheduled jobs recovered**',
  ];

  for (const v of opened) {
    lines.push(`- \`${v.source.path}\` — ${v.reason}. ${v.source.label}`);
  }

  for (const v of repeated) {
    const since = open[v.source.path]?.since;
    const held = since ? `, still down after ${downFor(since, now)}` : '';
    lines.push(`- \`${v.source.path}\` — ${v.reason}${held}. ${v.source.label}`);
  }

  for (const v of recovered) {
    lines.push(
      `- Recovered: \`${v.source.path}\` is writing again. ${v.source.label}`,
    );
  }

  if (down > 0) {
    lines.push(
      '',
      `Repeats every ${REALERT_HOURS}h while a job stays down. Detail at /status.`,
    );
  }

  return lines.join('\n');
}
