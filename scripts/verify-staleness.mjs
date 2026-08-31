/*
 * Validation of the stale-data guard in src/lib/staleness.ts.
 *
 * The module is imported and is the subject — Node 22.6+ strips the types. It
 * imports src/lib/time.ts by value, so the resolver needs the extension taught
 * to it first; src/lib/time.ts is pure, so this exercises exactly the code the
 * pages run.
 *
 * Why this file exists: the guard's whole value is that a red banner means
 * something. The obvious implementation — "stale when older than the last
 * close" — is wrong every evening, and a banner that appears every evening is
 * one nobody reads on the Wednesday morning when the feed is genuinely dead.
 * The table below is the specification: each row is a moment, a snapshot, and
 * the verdict that moment deserves.
 *
 * All times are given as New York wall clock and converted with the same
 * helper the app uses, so the checks stay correct across a DST change.
 *
 * Run: npm run verify:staleness
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { marketTimeToUtcMs } = await import('../src/lib/time.ts');
const { assessStaleness, assessDailySnapshot, expectedDailyDate, inSession, lastCompletedSession } =
  await import('../src/lib/staleness.ts');

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
 * A settled week in late August 2026, chosen for having no DST boundary and no
 * US market holiday in it:
 *
 *   Mon 2026-08-24, Tue 2026-08-25, Wed 2026-08-26
 *   Sat 2026-08-29, Sun 2026-08-30
 */
const MON = '2026-08-24';
const TUE = '2026-08-25';
const WED = '2026-08-26';
const SAT = '2026-08-29';

// --- session arithmetic ------------------------------------------------------

section('Which session counts as the last completed one');

eq(
  'mid-session Tuesday looks back to Monday',
  lastCompletedSession(et(TUE, 11)).date,
  MON,
);
eq(
  'after the Tuesday close it is Tuesday',
  lastCompletedSession(et(TUE, 17)).date,
  TUE,
);
eq(
  'Tuesday before the open still looks back to Monday',
  lastCompletedSession(et(TUE, 8)).date,
  MON,
);
eq(
  'Saturday walks back over the weekend to Friday',
  lastCompletedSession(et(SAT, 12)).date,
  '2026-08-28',
);

ok('11:00 Tuesday is in session', inSession(et(TUE, 11)));
ok('08:00 Tuesday is not', !inSession(et(TUE, 8)));
ok('17:00 Tuesday is not', !inSession(et(TUE, 17)));
ok('Saturday noon is not', !inSession(et(SAT, 12)));
ok('09:30 exactly is in session', inSession(et(TUE, 9, 30)));
ok('09:29 is not', !inSession(et(TUE, 9, 29)));

// --- the verdicts that matter ------------------------------------------------

section('Continuous snapshots');

/*
 * Each row: [description, now, snapshot, expected `stale`].
 *
 * These are the cases from the doc comment on assessStaleness, written out so
 * a future change to the tolerance or the reference point has to confront them
 * one at a time.
 */
const cases = [
  ['mid-session, yesterday afternoon data is broken', et(TUE, 11), et(MON, 15), true],
  ['mid-session, this morning data is fine', et(TUE, 11), et(TUE, 9, 45), false],
  ['mid-session, an hour old is inside tolerance', et(TUE, 11), et(TUE, 10), false],
  ['mid-session, two hours old is not', et(TUE, 11), et(TUE, 9), true],
  ['after the close, end-of-day data is fine', et(TUE, 20), et(TUE, 15, 50), false],
  ['after the close, yesterday data is broken', et(TUE, 20), et(MON, 15, 50), true],
  ['before the open, last close data is fine', et(TUE, 9), et(MON, 15, 50), false],
  ['before the open, two-day-old data is broken', et(WED, 9), et(MON, 15, 50), true],
  ['weekend, Friday close data is fine', et(SAT, 12), et('2026-08-28', 15, 50), false],
  ['weekend, Thursday data is broken', et(SAT, 12), et('2026-08-27', 15, 50), true],
];

for (const [label, now, snapshot, expected] of cases) {
  eq(label, assessStaleness(snapshot.toISOString(), now).stale, expected);
}

section('Snapshots with nothing usable in them');

ok('a missing timestamp is stale', assessStaleness(null, et(TUE, 11)).stale);
ok('so is an unparseable one', assessStaleness('not a date', et(TUE, 11)).stale);
eq(
  'and the age is reported as unknown rather than zero',
  assessStaleness(null, et(TUE, 11)).ageHours,
  null,
);

section('The reported age');

{
  const result = assessStaleness(et(TUE, 9).toISOString(), et(TUE, 11));
  eq('two hours reads as 2', result.ageHours, 2);
  ok('and carries a formatted stamp', typeof result.asOfLabel === 'string');
  ok('and a finished sentence to show', /\.$/.test(result.expectedNote), result.expectedNote);
}

// --- the once-a-day check ----------------------------------------------------

section('Once-a-day snapshots are graded by session, not by the clock');

eq('after 09:00 ET the post should be today', expectedDailyDate(et(TUE, 10)), TUE);
eq('at 08:00 ET yesterday is still the newest there is', expectedDailyDate(et(TUE, 8)), MON);
eq('on a Saturday it is Friday', expectedDailyDate(et(SAT, 12)), '2026-08-28');

ok(
  'a six-hour-old post from this morning is not stale',
  !assessDailySnapshot(TUE, et(TUE, 9).toISOString(), et(TUE, 15)).stale,
);
ok(
  "yesterday's post during today's session is stale",
  assessDailySnapshot(MON, et(MON, 9).toISOString(), et(TUE, 15)).stale,
);
ok(
  "yesterday's post before today's is due is not",
  !assessDailySnapshot(MON, et(MON, 9).toISOString(), et(TUE, 8)).stale,
);
ok('a post with no date at all is stale', assessDailySnapshot(null, null, et(TUE, 15)).stale);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
