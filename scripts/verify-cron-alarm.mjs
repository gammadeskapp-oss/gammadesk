/*
 * Validation of the job-level cron alarm — src/lib/cronDue.ts and
 * src/lib/cronAlarmState.ts.
 *
 * This exists because the alarm is the one piece of the system whose failures
 * are, by construction, invisible. Every other module is wrong in a way
 * somebody eventually sees on a page. An alarm is wrong by staying quiet, and
 * a quiet alarm is indistinguishable from a healthy system right up until the
 * moment the data has been stale for four days.
 *
 * Four failure modes, all of which produce a plausible-looking alarm rather
 * than an obvious break:
 *
 *   1. **The Monday false positive.** Every after-close job is 63 hours old at
 *      the Monday open and perfectly healthy. An alarm that grades on age
 *      alone fires on all of them every week, gets muted, and is then not
 *      there on the Tuesday something actually breaks. Section 2.
 *
 *   2. **The daylight-saving hour.** "Due at 09:00 ET" is a different UTC
 *      instant in December than in July. Resolve it with a hard-coded offset
 *      and every job reads as an hour late — or an hour early, which silently
 *      excuses a job that genuinely did not run — for the fortnight around
 *      each boundary. This is the same bug class the alarm was built to catch,
 *      so having it in the alarm itself would be a particular embarrassment.
 *      Section 3.
 *
 *   3. **The holiday.** Thanksgiving is not a failed cron. A due model that
 *      does not consult the calendar reports every weekday-scheduled job as
 *      late on every market holiday. Section 4.
 *
 *   4. **The repeat cadence.** The rule is: announce once, repeat every six
 *      hours while it stays down, announce the recovery. Each of those can be
 *      off by one in a way that reads as working — repeating every run (noise
 *      until muted), never repeating (silent-and-broken, the exact outcome the
 *      feature exists to prevent), or never clearing (a fresh outage reported
 *      as a four-day-old one). Section 5.
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { marketTimeToUtcMs } = await import('../src/lib/time.ts');
const { lastDueInstant, describeDue } = await import('../src/lib/cronDue.ts');
const { diffAlarmState, applyAlarmDiff, REALERT_HOURS } = await import(
  '../src/lib/cronAlarmState.ts'
);
const { sessionRules, NO_CALENDAR } = await import('../src/lib/events/rules.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function eq(label, actual, expected) {
  ok(
    label,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function section(name) {
  console.log(`\n${name}`);
}

/** New York wall clock -> Date. `et('2026-08-26', 11, 0)`. */
function et(date, hour, minute = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(marketTimeToUtcMs(y, m, d, hour, minute));
}

/*
 * A calendar with one holiday and one early close, so the walk-back has
 * something real to skip. Thanksgiving 2026 is Thursday 26 November; the day
 * after is a 13:00 close.
 */
const rules = sessionRules({
  events: [],
  marketCalendar: [
    {
      date: '2026-11-26',
      status: 'closed',
      name: 'Thanksgiving',
      confirmed: true,
    },
    {
      date: '2026-11-27',
      status: 'early-close',
      closeEt: '13:00',
      name: 'Day after Thanksgiving',
      confirmed: true,
    },
  ],
});

const DAILY_0900 = { kind: 'daily', atEt: '09:00' };
const CONTINUOUS = { kind: 'continuous' };

/* ------------------------------------------------------------------ */
section('1. A daily job, graded on an ordinary weekday');

/*
 * Wednesday 2 September 2026. A job due at 09:00 with 90 minutes of grace is
 * not yet gradeable at 10:00 — the grace has not run out — and is gradeable
 * from 10:30.
 */
{
  const before = lastDueInstant(DAILY_0900, 90, et('2026-09-02', 10, 0), rules);
  eq(
    'inside the grace window, the job is not yet due',
    before,
    et('2026-09-01', 9, 0).getTime(),
  );

  const after = lastDueInstant(DAILY_0900, 90, et('2026-09-02', 10, 31), rules);
  eq(
    'past the grace window, today is the reference',
    after,
    et('2026-09-02', 9, 0).getTime(),
  );
}

/*
 * The point of the grace: a job that ran late but ran is not late. Vercel's
 * free plan can delay a cron by up to an hour, and an alarm that does not
 * allow for that pages about a job that is working.
 */
{
  const now = et('2026-09-02', 10, 31);
  const due = lastDueInstant(DAILY_0900, 90, now, rules);
  const ranLate = et('2026-09-02', 9, 50).getTime();
  ok('a job delayed 50 minutes is not late', ranLate >= due);
}

/* ------------------------------------------------------------------ */
section('2. Monday morning — the false positive that mutes an alarm');

/*
 * Monday 7 September 2026, 10:00 ET. An after-close job last wrote on Friday
 * evening and is 63 hours old. Age alone says catastrophe; the due model says
 * it has not been due since Friday, because Monday's 18:10 has not arrived.
 */
{
  const now = et('2026-09-07', 10, 0);
  const evening = { kind: 'daily', atEt: '18:10' };
  const due = lastDueInstant(evening, 120, now, rules);
  eq(
    'an evening job is graded against Friday, not against Monday',
    due,
    et('2026-09-04', 18, 10).getTime(),
  );

  const wroteFriday = et('2026-09-04', 18, 12).getTime();
  ok('Friday evening write is not late on Monday morning', wroteFriday >= due);

  const ageHours = (now.getTime() - wroteFriday) / 3_600_000;
  ok(
    'and it really is old enough that a flat limit would have fired',
    ageHours > 60,
    `age was ${ageHours.toFixed(1)}h`,
  );
}

/* A continuous job outside the session is graded against the last close. */
{
  const now = et('2026-09-07', 8, 0); // Monday, before the open
  const due = lastDueInstant(CONTINUOUS, 15, now, rules);
  eq(
    'a continuous job before the open is graded against Friday close',
    due,
    et('2026-09-04', 16, 0).getTime(),
  );
}

/* Inside the session it is graded against the clock, less its grace. */
{
  const now = et('2026-09-02', 11, 0);
  const due = lastDueInstant(CONTINUOUS, 15, now, rules);
  eq(
    'a continuous job in session is graded against now less grace',
    due,
    now.getTime() - 15 * 60_000,
  );

  ok(
    'a sample from ten minutes ago passes',
    et('2026-09-02', 10, 50).getTime() >= due,
  );
  ok(
    'a sample from an hour ago does not',
    et('2026-09-02', 10, 0).getTime() < due,
  );
}

/* ------------------------------------------------------------------ */
section('3. Daylight saving — the bug this whole change is about');

/*
 * The same nominal 09:00 ET job, either side of the November 2026 boundary.
 * The UTC hour it resolves to MUST differ, and by exactly one hour. A model
 * using a fixed offset passes one of these and fails the other.
 */
{
  const summer = lastDueInstant(DAILY_0900, 0, et('2026-07-15', 12, 0), rules);
  const winter = lastDueInstant(DAILY_0900, 0, et('2026-12-15', 12, 0), rules);

  eq('July 09:00 ET is 13:00 UTC', new Date(summer).getUTCHours(), 13);
  eq('December 09:00 ET is 14:00 UTC', new Date(winter).getUTCHours(), 14);
}

/*
 * Across the boundary itself. US DST ends Sunday 1 November 2026. The Friday
 * before is EDT, the Monday after is EST, and a job due at 09:00 ET on each is
 * an hour apart in UTC — which is precisely why /api/post needed two cron
 * entries rather than one.
 */
{
  const friday = lastDueInstant(DAILY_0900, 0, et('2026-10-30', 12, 0), rules);
  const monday = lastDueInstant(DAILY_0900, 0, et('2026-11-02', 12, 0), rules);

  eq('Fri 30 Oct (EDT) resolves to 13:00 UTC', new Date(friday).getUTCHours(), 13);
  eq('Mon 2 Nov (EST) resolves to 14:00 UTC', new Date(monday).getUTCHours(), 14);
}

/*
 * And the consequence for the alarm: a job that posts at 09:00 local on both
 * days is on time on both days. Grading with a fixed offset would report the
 * winter run as an hour late every day from November to March — the same false
 * statement, in the opposite direction, as the bug in /api/post.
 */
{
  for (const [label, day] of [
    ['summer', '2026-10-30'],
    ['winter', '2026-11-02'],
  ]) {
    const now = et(day, 12, 0);
    const due = lastDueInstant(DAILY_0900, 90, now, rules);
    const wrote = et(day, 9, 1).getTime();
    ok(`a 09:00 local run is on time in ${label}`, wrote >= due);
  }
}

/* ------------------------------------------------------------------ */
section('4. Holidays and weekends are not failed crons');

/*
 * Friday 27 November 2026, the early close after Thanksgiving. A job due at
 * 09:00 is graded against today — the market is open, just briefly. But a job
 * graded on Thanksgiving itself must reach back to Wednesday.
 */
{
  const now = et('2026-11-26', 14, 0); // Thanksgiving, market closed
  const due = lastDueInstant(DAILY_0900, 90, now, rules);
  eq(
    'on a holiday, the reference is the previous trading day',
    due,
    et('2026-11-25', 9, 0).getTime(),
  );
}

{
  const now = et('2026-11-27', 12, 0); // early close day, still a trading day
  const due = lastDueInstant(DAILY_0900, 90, now, rules);
  eq(
    'an early-close day is still a trading day',
    due,
    et('2026-11-27', 9, 0).getTime(),
  );
}

/* Saturday: nothing has been due since Friday. */
{
  const now = et('2026-09-05', 12, 0);
  const due = lastDueInstant(DAILY_0900, 90, now, rules);
  eq('Saturday reaches back to Friday', due, et('2026-09-04', 9, 0).getTime());
}

/* The weekly job. Due Saturdays; on a Thursday the last one was five days ago. */
{
  const weekly = { kind: 'weekly', weekday: 6, atEt: '18:30' };
  const now = et('2026-09-10', 12, 0); // Thursday
  const due = lastDueInstant(weekly, 1440, now, rules);
  eq(
    'a Saturday job is graded against the previous Saturday',
    due,
    et('2026-09-05', 18, 30).getTime(),
  );
}

/* A malformed time disables the job quietly rather than alarming forever. */
{
  const broken = lastDueInstant(
    { kind: 'daily', atEt: 'not a time' },
    0,
    et('2026-09-02', 12, 0),
    rules,
  );
  eq('an unparseable schedule yields no due instant', broken, null);
}

/* Without a calendar the holiday reads as a trading day — a false alarm in
 * the harmless direction, and the documented degradation. */
{
  const now = et('2026-11-26', 14, 0);
  const due = lastDueInstant(DAILY_0900, 90, now, NO_CALENDAR);
  eq(
    'with no calendar, Thanksgiving is treated as an ordinary Thursday',
    due,
    et('2026-11-26', 9, 0).getTime(),
  );
}

/* ------------------------------------------------------------------ */
section('5. Announce once, repeat every six hours, announce recovery');

const LATE = [{ path: '/api/breadth/refresh', late: true }];
const HEALTHY = [{ path: '/api/breadth/refresh', late: false }];

/* First sighting: announced. */
let open = {};
let now = et('2026-09-02', 10, 0);
{
  const diff = diffAlarmState(LATE, open, now);
  eq('a newly late job is announced', diff.opened.length, 1);
  eq('and is not also counted as a repeat', diff.repeated.length, 0);
  open = applyAlarmDiff(open, diff, now);
  ok('the entry is remembered', Boolean(open['/api/breadth/refresh']));
}

/* Ten minutes later: silent. This is the noise the dedupe exists to stop —
 * the alarm cron runs hourly, so without this the channel gets the same line
 * every hour until someone mutes it. */
{
  now = et('2026-09-02', 10, 10);
  const diff = diffAlarmState(LATE, open, now);
  eq('ten minutes later it is suppressed', diff.suppressed.length, 1);
  eq('and nothing is announced', diff.opened.length + diff.repeated.length, 0);
}

/* One minute short of the cadence: still silent. */
{
  const at = new Date(et('2026-09-02', 10, 0).getTime() + REALERT_HOURS * 3_600_000 - 60_000);
  const diff = diffAlarmState(LATE, open, at);
  eq('a minute before the cadence, still silent', diff.repeated.length, 0);
}

/* Exactly the cadence: repeated. Boundary tested on the inclusive side,
 * because an alarm that needs 6h *and one tick* drifts later every cycle. */
{
  const at = new Date(et('2026-09-02', 10, 0).getTime() + REALERT_HOURS * 3_600_000);
  const diff = diffAlarmState(LATE, open, at);
  eq(`at exactly ${REALERT_HOURS}h it repeats`, diff.repeated.length, 1);

  const next = applyAlarmDiff(open, diff, at);
  eq(
    'the repeat preserves when it first went down',
    next['/api/breadth/refresh'].since,
    open['/api/breadth/refresh'].since,
  );
  eq(
    'and moves the last-told stamp forward',
    next['/api/breadth/refresh'].lastAlertedAt,
    at.toISOString(),
  );
  open = next;
}

/* Recovery: announced, and the entry cleared. */
{
  const at = et('2026-09-02', 20, 0);
  const diff = diffAlarmState(HEALTHY, open, at);
  eq('recovery is announced', diff.recovered.length, 1);

  const next = applyAlarmDiff(open, diff, at);
  ok(
    'and the entry is dropped, so the next failure reads as new',
    next['/api/breadth/refresh'] === undefined,
  );
  open = next;
}

/* A healthy job with no open entry says nothing at all. */
{
  const diff = diffAlarmState(HEALTHY, open, et('2026-09-02', 21, 0));
  eq(
    'a healthy job with no history is silent',
    diff.opened.length + diff.repeated.length + diff.recovered.length,
    0,
  );
}

/* A job that fails again after recovering is a new incident, not an old one. */
{
  const at = et('2026-09-03', 10, 0);
  const diff = diffAlarmState(LATE, open, at);
  eq('a repeat failure is announced fresh', diff.opened.length, 1);
  const next = applyAlarmDiff(open, diff, at);
  eq(
    'and dates from now, not from the earlier outage',
    next['/api/breadth/refresh'].since,
    at.toISOString(),
  );
}

/* A corrupt stamp repeats rather than going silent. */
{
  const corrupt = {
    '/api/breadth/refresh': { since: 'nonsense', lastAlertedAt: 'nonsense' },
  };
  const diff = diffAlarmState(LATE, corrupt, et('2026-09-02', 10, 0));
  eq('an unreadable stamp errs towards repeating', diff.repeated.length, 1);
}

/* ------------------------------------------------------------------ */
section('6. The schedule, in the words /status prints');

/*
 * The descriptor is what a reader sees beside a LATE row, and it has to name
 * the schedule the alarm actually grades against — not the cron expression.
 * A job registered at two UTC times is one daily job, and a row that showed
 * the expression would invite the reader to conclude the alarm is confused.
 */
eq(
  'continuous reads as a session-long feed',
  describeDue({ kind: 'continuous' }),
  'continuously while the market is open',
);
eq(
  'daily names the New York time',
  describeDue({ kind: 'daily', atEt: '9:00' }),
  'every trading day at 09:00 ET',
);
eq(
  'weekly names the day',
  describeDue({ kind: 'weekly', weekday: 6, atEt: '18:30' }),
  'every Saturday at 18:30 ET',
);
ok(
  'an unparseable time still produces a printable string',
  typeof describeDue({ kind: 'daily', atEt: 'nope' }) === 'string',
);

/* ------------------------------------------------------------------ */
console.log(
  `\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ''}`,
);
process.exit(failures === 0 ? 0 : 1);
