/*
 * Validation of the level-history statistics in src/lib/history/build.ts.
 *
 * Why this file exists: this is the only place on the site that makes a
 * quantitative claim about whether the levels do anything. Everywhere else
 * describes a measurement; here the app counts successes, and a quietly wrong
 * denominator is an overstatement no reader could detect.
 *
 * The specific mistake being guarded against is counting days where price
 * never went near the level. Include those and every level looks excellent,
 * because most days most levels are never tested. Each case below is a
 * hand-built session whose correct answer is obvious by inspection.
 *
 * Run: npm run verify:history
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { buildHistory, BAND_PCT, fraction, sampleCaveat } = await import(
  '../src/lib/history/build.ts'
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

function bar(date, o, h, l, c) {
  return { date, open: o, high: h, low: l, close: c, volume: 0 };
}

function entry(date, over) {
  return {
    date,
    snapshotAt: `${date}T13:45:00.000Z`,
    regime: 'positive',
    flipLevel: null,
    spotAtSnapshot: 100,
    magnetAbove: null,
    magnetBelow: null,
    netGex: 0,
    settled: true,
    ...over,
  };
}

function run(entries, bars) {
  return buildHistory({ entries, bars, symbol: 'SPY', window: 30, barsSource: 'yahoo' });
}

// --- the band ----------------------------------------------------------------

section('The band is a fraction of the level, not a fixed number of dollars');

ok('band is a tenth of a percent', BAND_PCT === 0.001, String(BAND_PCT));

// --- resistance --------------------------------------------------------------

section('A level above price');

{
  // High reaches 110 exactly, close falls back to 105. Turned there.
  const view = run(
    [entry('2026-08-03', { stallLevel: 110 })],
    [bar('2026-08-03', 100, 110, 99, 105)],
  );
  eq('recorded once', view.stats.stall.available, 1);
  eq('reached', view.stats.stall.reached, 1);
  eq('turned there', view.stats.stall.stopped, 1);
  eq('did not go through', view.stats.stall.wentThrough, 0);
}

{
  // High 112, close 111 — straight through.
  const view = run(
    [entry('2026-08-03', { stallLevel: 110 })],
    [bar('2026-08-03', 100, 112, 99, 111)],
  );
  eq('reached', view.stats.stall.reached, 1);
  eq('not counted as a stop', view.stats.stall.stopped, 0);
  eq('counted as through', view.stats.stall.wentThrough, 1);
}

{
  /*
   * The case the whole file exists for. Price topped out at 104 against a
   * level at 110 — it was never tested. Neither column may claim it.
   */
  const view = run(
    [entry('2026-08-03', { stallLevel: 110 })],
    [bar('2026-08-03', 100, 104, 99, 103)],
  );
  eq('the level was available', view.stats.stall.available, 1);
  eq('but never reached', view.stats.stall.reached, 0);
  eq('so not a stop', view.stats.stall.stopped, 0);
  eq('and not a break', view.stats.stall.wentThrough, 0);
}

{
  // Closed inside the band: reached, but claimed by neither side.
  const view = run(
    [entry('2026-08-03', { stallLevel: 110 })],
    [bar('2026-08-03', 100, 110.05, 99, 110.02)],
  );
  eq('reached', view.stats.stall.reached, 1);
  eq('not a stop', view.stats.stall.stopped, 0);
  eq('not a break', view.stats.stall.wentThrough, 0);
}

// --- support -----------------------------------------------------------------

section('A level below price');

{
  const view = run(
    [entry('2026-08-03', { bounceLevel: 90 })],
    [bar('2026-08-03', 100, 101, 90, 95)],
  );
  eq('reached', view.stats.bounce.reached, 1);
  eq('turned there', view.stats.bounce.stopped, 1);
  eq('not through', view.stats.bounce.wentThrough, 0);
}

{
  const view = run(
    [entry('2026-08-03', { bounceLevel: 90 })],
    [bar('2026-08-03', 100, 101, 88, 89)],
  );
  eq('through', view.stats.bounce.wentThrough, 1);
  eq('not a stop', view.stats.bounce.stopped, 0);
}

{
  const view = run(
    [entry('2026-08-03', { bounceLevel: 90 })],
    [bar('2026-08-03', 100, 101, 96, 97)],
  );
  eq('never reached', view.stats.bounce.reached, 0);
  eq('and not scored', view.stats.bounce.stopped + view.stats.bounce.wentThrough, 0);
}

// --- the flip ----------------------------------------------------------------

section('The flip is scored on which side the day finished');

{
  // Started above 100, dipped to 98, closed back at 101. Held.
  const view = run(
    [entry('2026-08-03', { flipLevel: 100, spotAtSnapshot: 102 })],
    [bar('2026-08-03', 102, 103, 98, 101)],
  );
  eq('crossed', view.stats.flip.reached, 1);
  eq('held', view.stats.flip.stopped, 1);
  eq('not broken', view.stats.flip.wentThrough, 0);
}

{
  // Started above, closed below. Broke.
  const view = run(
    [entry('2026-08-03', { flipLevel: 100, spotAtSnapshot: 102 })],
    [bar('2026-08-03', 102, 103, 96, 97)],
  );
  eq('broke', view.stats.flip.wentThrough, 1);
  eq('not held', view.stats.flip.stopped, 0);
}

{
  // Never crossed at all — not scored either way.
  const view = run(
    [entry('2026-08-03', { flipLevel: 100, spotAtSnapshot: 102 })],
    [bar('2026-08-03', 102, 105, 101, 104)],
  );
  eq('available', view.stats.flip.available, 1);
  eq('never crossed', view.stats.flip.reached, 0);
}

{
  // Below the flip, closing above it, is a break in the other direction.
  const view = run(
    [entry('2026-08-03', { flipLevel: 100, spotAtSnapshot: 97 })],
    [bar('2026-08-03', 97, 103, 96, 102)],
  );
  eq('crossed upward', view.stats.flip.reached, 1);
  eq('and closed through', view.stats.flip.wentThrough, 1);
}

// --- the two definitions -----------------------------------------------------

section('Older entries fall back to the magnet, and are counted as such');

{
  const view = run(
    [
      entry('2026-08-03', { magnetAbove: 110, magnetBelow: 90 }),
      entry('2026-08-04', { stallLevel: 110, bounceLevel: 90, magnetAbove: 120, magnetBelow: 80 }),
    ],
    [bar('2026-08-03', 100, 110, 99, 105), bar('2026-08-04', 100, 110, 99, 105)],
  );

  eq('both days score the level above', view.stats.stall.available, 2);
  eq('the legacy day is counted', view.legacyDefinitionDays, 1);
  eq('the newer day is not', view.days[1].displayedLevelsMissing, false);
  ok(
    'the newer day uses the displayed level, not the magnet',
    view.days[1].stall === 110,
    String(view.days[1].stall),
  );
}

// --- gaps --------------------------------------------------------------------

section('A trading day with no recorded levels stays a gap');

{
  const view = run(
    [entry('2026-08-04', { stallLevel: 110 })],
    [bar('2026-08-03', 100, 104, 99, 103), bar('2026-08-04', 100, 110, 99, 105)],
  );
  eq('both sessions are plotted', view.days.length, 2);
  eq('the unrecorded one carries no level', view.days[0].stall, null);
  eq('and is not in the sample', view.sampleSize, 1);
  eq('the level was available once', view.stats.stall.available, 1);
}

section('The window keeps the most recent sessions');

{
  const bars = Array.from({ length: 40 }, (_, i) =>
    bar(`2026-07-${String(i + 1).padStart(2, '0')}`, 100, 101, 99, 100),
  );
  const view = buildHistory({ entries: [], bars, symbol: 'SPY', window: 30, barsSource: null });
  eq('thirty days', view.days.length, 30);
  eq('ending at the newest', view.days[29].date, bars[39].date);
}

// --- the empty state ---------------------------------------------------------

section('Nothing recorded is reported as nothing, not as zero');

{
  const view = run([], [bar('2026-08-03', 100, 104, 99, 103)]);
  ok('empty is flagged', view.empty);
  eq('no collecting-since date', view.collectingSince, null);
  eq('sample size is zero', view.sampleSize, 0);
}

{
  const view = run(
    [entry('2026-08-03', { stallLevel: 110 }), entry('2026-08-04', { stallLevel: 110 })],
    [bar('2026-08-03', 100, 104, 99, 103), bar('2026-08-04', 100, 104, 99, 103)],
  );
  ok('not empty once something is recorded', !view.empty);
  eq('collecting since the earliest entry', view.collectingSince, '2026-08-03');
}

// --- the wording -------------------------------------------------------------

section('Counts are shown as fractions, and small samples say so');

eq('a fraction reads as a fraction', fraction(4, 11), '4 of 11 days');
eq('one day is singular', fraction(1, 1), '1 of 1 day');
eq('nothing to measure is said plainly', fraction(0, 0), 'no days to measure');

ok('an empty sample says there is nothing', /nothing to measure/i.test(sampleCaveat(0)));
ok('a small sample says it proves nothing', /proves nothing/i.test(sampleCaveat(11)));
ok('and names the size', sampleCaveat(11).includes('11'));
ok(
  'even a full window is still called small',
  /still a small sample/i.test(sampleCaveat(30)),
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
