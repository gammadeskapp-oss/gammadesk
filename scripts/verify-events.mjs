/*
 * Validation of the hand-maintained calendar in src/lib/events/calendar.json.
 *
 * Why this file exists: the calendar is edited by hand, and the failure mode
 * of a hand-edited file is not corruption but plausibility — a date one day
 * out, an importance spelled "High", an early close with no closing time. None
 * of those throw. They quietly produce a page that says nothing is scheduled
 * on the morning of a CPI print, or a staleness guard that treats a holiday as
 * a full session.
 *
 * The JSON is read with `fs`, not imported, because Node's type-stripping
 * loader cannot import JSON without an import attribute TypeScript does not
 * emit — the same constraint that keeps the JSON out of `rules.ts`.
 *
 * Dates are checked for internal consistency, never against the outside world:
 * whether the Fed really meets on 2026-09-16 is not something a test can know,
 * and pretending otherwise would give false assurance. What is checked is that
 * every date is real, falls on a plausible weekday, and is marked confirmed or
 * not.
 *
 * Run: npm run verify:events
 */

import { readFileSync } from 'node:fs';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { eventsForRow, hasHighImportanceToday, sessionRules, validateCalendar } =
  await import('../src/lib/events/rules.ts');

const calendar = JSON.parse(
  readFileSync(new URL('../src/lib/events/calendar.json', import.meta.url), 'utf8'),
);

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

/** Day of week for `YYYY-MM-DD`, 0 = Sunday. */
function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True when the string is a real calendar date, not just well-shaped. */
function isRealDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

// --- the shape ---------------------------------------------------------------

section('The shipped file passes its own validator');

{
  const problems = validateCalendar(calendar);
  ok('no structural problems', problems.length === 0, problems.join(' | '));
}

section('The validator actually catches things');

{
  // A validator nobody has seen fail is a validator that might not run.
  const bad = {
    events: [
      { date: '2026-13-01', timeEt: '25:00', name: '', importance: 'High' },
    ],
    marketCalendar: [{ date: 'soon', status: 'shut', name: 'x' }],
  };
  const problems = validateCalendar(bad);
  ok('a malformed date is reported', problems.some((p) => /YYYY-MM-DD/.test(p)));
  ok('a malformed time is reported', problems.some((p) => /HH:MM/.test(p)));
  ok('a bad importance is reported', problems.some((p) => /importance/.test(p)));
  ok('a bad status is reported', problems.some((p) => /status/.test(p)));
  ok('a missing confirmed flag is reported', problems.some((p) => /confirmed/.test(p)));
  ok('and a non-object is refused outright', validateCalendar(null).length === 1);
}

// --- the dates themselves ----------------------------------------------------

section('Every date is real and lands on a weekday');

for (const event of calendar.events) {
  const at = `${event.name} ${event.date}`;
  ok(`${at} is a real date`, isRealDate(event.date));
  /*
   * Economic releases and Fed decisions do not happen at weekends. This is the
   * check that catches a typo turning the 11th into the 15th two months out,
   * which is otherwise invisible until the morning it matters.
   */
  const day = weekday(event.date);
  ok(`${at} is not a weekend`, day >= 1 && day <= 5, `weekday ${day}`);
}

for (const day of calendar.marketCalendar) {
  ok(`${day.name} ${day.date} is a real date`, isRealDate(day.date));
  const dow = weekday(day.date);
  // A weekend holiday entry is not wrong, but it is pointless — the guard
  // already knows the market is shut — and it usually means a mistyped date.
  ok(
    `${day.name} ${day.date} is a weekday, or it does nothing`,
    dow >= 1 && dow <= 5,
    `weekday ${dow}`,
  );
}

section('Known anchors are where they should be');

/*
 * Spot checks on facts that are structural rather than announced: FOMC
 * decisions are always the second day of a two-day meeting, which is a
 * Wednesday, and the Employment Situation is the first Friday.
 */
for (const event of calendar.events.filter((e) => e.name === 'FOMC decision')) {
  eq(`FOMC ${event.date} falls on a Wednesday`, weekday(event.date), 3);
  eq(`FOMC ${event.date} is at 14:00 ET`, event.timeEt, '14:00');
}

for (const event of calendar.events.filter((e) => e.name === 'Jobs report')) {
  eq(`Jobs report ${event.date} falls on a Friday`, weekday(event.date), 5);
  eq(`Jobs report ${event.date} is at 08:30 ET`, event.timeEt, '08:30');
  const dayOfMonth = Number(event.date.split('-')[2]);
  ok(
    `Jobs report ${event.date} is the first Friday`,
    dayOfMonth <= 7,
    `day ${dayOfMonth}`,
  );
}

section('Nothing unconfirmed is passed off as confirmed');

{
  const unconfirmed = calendar.events.filter((e) => !e.confirmed);
  ok('some events are marked unconfirmed', unconfirmed.length > 0);
  ok(
    'every CPI and PPI date is marked unconfirmed',
    calendar.events
      .filter((e) => e.name === 'CPI' || e.name === 'PPI')
      .every((e) => !e.confirmed),
    'these are pattern estimates and must say so',
  );
  ok(
    'the readme names where to check them',
    calendar.readme.join(' ').includes('bls.gov'),
  );
}

// --- the row -----------------------------------------------------------------

section('The row shows today and tomorrow, and nothing else');

{
  const cal = {
    events: [
      { date: '2026-09-15', timeEt: '08:30', name: 'Yesterday', importance: 'high', confirmed: true },
      { date: '2026-09-16', timeEt: '14:00', name: 'Later today', importance: 'high', confirmed: true },
      { date: '2026-09-16', timeEt: '08:30', name: 'Earlier today', importance: 'medium', confirmed: true },
      { date: '2026-09-17', timeEt: '08:30', name: 'Tomorrow', importance: 'medium', confirmed: true },
      { date: '2026-09-18', timeEt: '08:30', name: 'Too far out', importance: 'high', confirmed: true },
    ],
    marketCalendar: [],
  };

  const rows = eventsForRow(cal, '2026-09-16');
  eq('three rows', rows.length, 3);
  eq('yesterday is gone', rows.some((r) => r.name === 'Yesterday'), false);
  eq('the day after tomorrow is gone', rows.some((r) => r.name === 'Too far out'), false);
  eq('earliest today first', rows[0].name, 'Earlier today');
  eq('then later today', rows[1].name, 'Later today');
  eq('then tomorrow', rows[2].name, 'Tomorrow');
  eq("today is labelled 'today'", rows[0].when, 'today');
  eq("tomorrow is labelled 'tomorrow'", rows[2].when, 'tomorrow');

  ok('a high-importance event today is detected', hasHighImportanceToday(cal, '2026-09-16'));
  /*
   * On the 17th the only event is medium; the high-importance one is on the
   * 18th. The warning is about today, so it must stay off — a row that warns
   * because something is scheduled tomorrow warns every other day.
   */
  ok(
    'a high-importance event tomorrow does not trigger the warning',
    !hasHighImportanceToday(cal, '2026-09-17'),
  );
  ok(
    'a day with only medium events does not trigger it',
    !hasHighImportanceToday(
      { events: [{ date: '2026-09-16', timeEt: '08:30', name: 'x', importance: 'medium', confirmed: true }], marketCalendar: [] },
      '2026-09-16',
    ),
  );
  ok('an empty day shows nothing', eventsForRow(cal, '2026-01-05').length === 0);
}

// --- the session rules the guard consumes ------------------------------------

section('The shipped calendar produces working session rules');

{
  const rules = sessionRules(calendar);
  const closed = calendar.marketCalendar.find((d) => d.status === 'closed');
  const early = calendar.marketCalendar.find((d) => d.status === 'early-close');

  ok(`${closed.date} reads as closed`, rules.isClosed(closed.date));
  ok('an ordinary day does not', !rules.isClosed('2026-09-15'));
  eq('an ordinary day closes at 16:00', rules.closeHour('2026-09-15'), 16);
  eq(`${early.date} closes early`, rules.closeHour(early.date), 13);
  eq(`${early.date} closes on the hour`, rules.closeMinute(early.date), 0);
  ok(
    'a closed day is not also reported as an early close',
    rules.closeHour(closed.date) === 16,
    'closed days have no close time to shorten',
  );
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
