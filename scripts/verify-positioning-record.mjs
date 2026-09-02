/*
 * Validation for the settled-levels record on /decision.
 *
 * Why this file exists: the card states three percentages side by side, and
 * they are measured over different windows. The wall figures start on the day
 * those levels began being recorded and the other two run the whole log, so
 * the failure this guards against is the windows quietly merging — a wall rate
 * computed across days that never carried a wall would read as a longer,
 * better-supported series than it is.
 *
 * It also pins the two "nothing to say" cases apart. A window with no judgeable
 * day must report null, never 0%: the first says nothing has been recorded,
 * the second says the level never worked, and only one of them is a claim
 * about the market.
 *
 * Run: npm run verify:positioning-record
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { summarisePositioningRecord } = await import('../src/lib/log/positioningRecord.ts');

let passed = 0;
const failures = [];

function section(name) {
  console.log(`\n${name}\n`);
}

function ok(what, condition, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${what}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)}`}`);
}

function eq(what, actual, expected) {
  ok(what, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

/** A settled day, with only the fields the summary reads. */
function day(date, extra = {}) {
  return {
    date,
    snapshotAt: `${date}T13:45:00.000Z`,
    regime: 'positive',
    flipLevel: 100,
    spotAtSnapshot: 101,
    magnetAbove: 105,
    magnetBelow: 95,
    netGex: 1,
    settled: true,
    open: 101,
    high: 102,
    low: 100.5,
    close: 101.5,
    flipOutcome: 'held',
    magnetTouched: 'none',
    ...extra,
  };
}

// --- the two windows stay separate --------------------------------------------

section('The wall window is shorter, and stays shorter');

{
  const entries = [
    day('2026-08-20'),
    day('2026-08-21'),
    // Only these two carry the levels the site displays.
    day('2026-08-31', { stallLevel: 102, bounceLevel: 99 }),
    day('2026-09-01', { stallLevel: 110, bounceLevel: 90 }),
  ];
  const r = summarisePositioningRecord(entries);

  eq('every settled day counts toward the flip window', r.flip.judged, 4);
  eq('every settled day counts toward the magnet window', r.magnet.judged, 4);
  eq('only the days carrying walls count toward the wall window', r.wall.judged, 2);
  eq('and the wall window reports its own start date', r.wall.from, '2026-08-31');
  eq('while the longer windows report theirs', r.flip.from, '2026-08-20');
}

// --- absent and null are different --------------------------------------------

section('A day with no wall is not the same as a day nobody recorded');

{
  // `null` means the chain published no qualifying wall that day. It was
  // recorded, so it belongs in the denominator as a day the wall was not hit.
  const r = summarisePositioningRecord([
    day('2026-09-01', { stallLevel: null, bounceLevel: null }),
  ]);
  eq('a recorded-but-empty wall day is judged', r.wall.judged, 1);
  eq('and counts as not reached', r.wall.hit, 0);
}

{
  // Absent means nobody was recording yet. It cannot be judged at all.
  const r = summarisePositioningRecord([day('2026-08-01')]);
  eq('a day predating the fields is not judged', r.wall.judged, 0);
  eq('and the rate is null rather than zero', r.wall.pct, null);
}

// --- nothing recorded is not nothing happening --------------------------------

section('An unjudgeable window says nothing, it does not say zero');

{
  const r = summarisePositioningRecord([]);
  eq('no entries means no settled days', r.daysSettled, 0);
  ok('the flip rate is null, not 0', r.flip.pct === null, r.flip.pct);
  ok('the magnet rate is null, not 0', r.magnet.pct === null, r.magnet.pct);
  ok('the wall rate is null, not 0', r.wall.pct === null, r.wall.pct);
}

{
  // A real 0% is still reachable and must not be confused with the above.
  const r = summarisePositioningRecord([
    day('2026-09-01', { stallLevel: 200, bounceLevel: 1 }),
  ]);
  eq('a wall that was never reached is a real zero', r.wall.pct, 0);
  ok('and it is judged, unlike the null case', r.wall.judged === 1, r.wall.judged);
}

// --- unsettled days are excluded ----------------------------------------------

section('Only settled days are counted');

{
  const r = summarisePositioningRecord([
    day('2026-09-01'),
    { ...day('2026-09-02'), settled: false },
  ]);
  eq('an unsettled day is not in the settled count', r.daysSettled, 1);
  eq('nor in the flip window', r.flip.judged, 1);
}

// --- the touch test -----------------------------------------------------------

section('A wall counts as reached when the range got there');

{
  const r = summarisePositioningRecord([
    // high 102 reaches a 102 stall level: touching counts, per judge().
    day('2026-09-01', { stallLevel: 102, bounceLevel: 90 }),
    // low 100.5 reaches a 100.5 bounce level from the other side.
    day('2026-09-02', { stallLevel: 500, bounceLevel: 100.5 }),
    // Neither side reached.
    day('2026-09-03', { stallLevel: 500, bounceLevel: 1 }),
  ]);
  eq('both sides count as a touch', r.wall.hit, 2);
  eq('over the three recorded days', r.wall.judged, 3);
}

{
  // Without a settled high/low there is nothing to judge against.
  const r = summarisePositioningRecord([
    { ...day('2026-09-01', { stallLevel: 102, bounceLevel: 99 }), high: undefined, low: undefined },
  ]);
  eq('a day with no range is not judged', r.wall.judged, 0);
}

// --- the regime split ---------------------------------------------------------

section('The regime split covers the settled days');

{
  const r = summarisePositioningRecord([
    day('2026-09-01', { regime: 'positive' }),
    day('2026-09-02', { regime: 'negative' }),
    day('2026-09-03', { regime: 'negative' }),
    { ...day('2026-09-04', { regime: 'positive' }), settled: false },
  ]);
  eq('positive sessions', r.regimePositive, 1);
  eq('negative sessions', r.regimeNegative, 2);
  ok(
    'and the two add up to the settled days',
    r.regimePositive + r.regimeNegative === r.daysSettled,
    [r.regimePositive, r.regimeNegative, r.daysSettled],
  );
}

// --- report -------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\n${passed} checks passed\n`);
