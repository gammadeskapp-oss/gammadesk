/*
 * Validation of the analogue engine in src/lib/analogues/.
 *
 * Why this file exists: the page states match counts and quantiles of what
 * followed them, and both failure modes are invisible in a rendered table.
 *
 *   - A detector that fires on every bar of a streak instead of the bar that
 *     completes it inflates every count, and the inflated table looks exactly
 *     like the honest one.
 *   - A forward return that counts a window which has not finished yet biases
 *     the long horizons toward the last few weeks, which is where the reader
 *     is looking hardest.
 *
 * Every series below is hand-built and its correct answer is obvious by
 * inspection.
 *
 * Run: npm run verify:analogues
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { detect, CONDITIONS } = await import('../src/lib/analogues/conditions.ts');
const {
  outcomesAt, buildMatches, summarise, honestyOf, LONGEST, baselineFor,
  buildBaseline,
} = await import('../src/lib/analogues/forward.ts');

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
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function close(label, actual, expected, tol = 1e-9) {
  ok(
    label,
    typeof actual === 'number' && Math.abs(actual - expected) < tol,
    `expected ~${expected}, got ${actual}`,
  );
}

function section(name) {
  console.log(`\n${name}`);
}

/** A bar series from closes alone. Opens equal the close unless overridden. */
function series(closes, opens) {
  return closes.map((c, i) => ({
    date: `2020-01-${String(i + 1).padStart(2, '0')}`,
    open: opens ? opens[i] : c,
    high: c,
    low: c,
    close: c,
    volume: 0,
  }));
}

/** Dates rather than indices, since the dates are what the page shows. */
function dates(bars, indices) {
  return indices.map((i) => bars[i].date);
}

section('Consecutive closes fire on the bar that completes the run');
{
  //            0   1   2   3   4   5   6   7   8
  const bars = series([100, 99, 98, 97, 96, 97, 96, 95, 94]);
  // Down closes at 1,2,3,4 then 6,7,8. Third of the first run is index 3,
  // third of the second run is index 8.
  eq('down-3 fires twice', dates(bars, detect(bars, 'down-3')), ['2020-01-04', '2020-01-09']);
  // The fourth down close of the first run only.
  eq('down-4 fires once', dates(bars, detect(bars, 'down-4')), ['2020-01-05']);
  eq('down-5 never fires', detect(bars, 'down-5'), []);
  ok('a five-day slide is not four down-3 matches', detect(bars, 'down-3').length === 2);
}
{
  const bars = series([100, 101, 102, 103, 104, 105]);
  eq('up-3 fires on the third up close', dates(bars, detect(bars, 'up-3')), ['2020-01-04']);
  eq('up-4 fires on the fourth', dates(bars, detect(bars, 'up-4')), ['2020-01-05']);
  eq('up-5 fires on the fifth', dates(bars, detect(bars, 'up-5')), ['2020-01-06']);
}
{
  // An unchanged close breaks both directions — it is neither up nor down.
  const bars = series([100, 99, 98, 98, 97, 96]);
  eq('an unchanged close breaks the streak', detect(bars, 'down-3'), []);
}

section('Gaps read the open against the previous close');
{
  const closes = [100, 100, 100, 100];
  const opens = [100, 101.5, 98.5, 100.5];
  const bars = series(closes, opens);
  eq('gap up beyond 1%', dates(bars, detect(bars, 'gap-up-1')), ['2020-01-02']);
  eq('gap down beyond 1%', dates(bars, detect(bars, 'gap-down-1')), ['2020-01-03']);
  ok('a 0.5% gap does not fire', detect(bars, 'gap-up-1').length === 1);
}

section('Drawdown fires on the crossing, not on every day spent below');
{
  // 252 bars flat at 100 to define the trailing high, then a long slide.
  const closes = new Array(252).fill(100);
  for (let i = 0; i < 40; i += 1) closes.push(94 - i * 0.1);
  const bars = series(closes);

  const dd3 = detect(bars, 'dd-3');
  const dd5 = detect(bars, 'dd-5');
  eq('-3% fires exactly once for one decline', dd3.length, 1);
  eq('-5% fires exactly once for one decline', dd5.length, 1);
  eq('both cross on the first bar below', dd3[0], 252);
  ok('-10% never crosses in this series', detect(bars, 'dd-10').length === 0);
}
{
  // Down through -5%, back above the threshold, then down through it again.
  const closes = new Array(252).fill(100);
  closes.push(94, 94, 99, 99, 94);
  const bars = series(closes);
  eq('re-crossing counts as a second match', detect(bars, 'dd-5').length, 2);
}

section('RSI conditions fire on the crossing bar only');
{
  /*
   * A rise first, so RSI is defined and above 30 before the decline starts.
   * A series that only falls is already under 30 the first time RSI exists at
   * all, and that is not a crossing — nothing is known about where it came
   * from, so the detector correctly stays silent. The fixture has to establish
   * the prior side for the question to mean anything.
   */
  const closes = [];
  for (let i = 0; i < 30; i += 1) closes.push(100 + i);
  for (let i = 0; i < 60; i += 1) closes.push(130 - i);
  const bars = series(closes);
  const hits = detect(bars, 'rsi-under-30');
  eq('a decline off a rise crosses under 30 once', hits.length, 1);
  ok('and not on every subsequent bar below 30', hits.length < 5);
}
{
  const closes = [];
  for (let i = 0; i < 30; i += 1) closes.push(100 - i);
  for (let i = 0; i < 60; i += 1) closes.push(70 + i);
  const bars = series(closes);
  eq('an advance off a decline crosses over 70 once', detect(bars, 'rsi-over-70').length, 1);
}
{
  // A series that is already under 30 when RSI first exists never fires.
  const closes = [];
  for (let i = 0; i < 60; i += 1) closes.push(100 - i);
  const bars = series(closes);
  eq('no crossing is invented at the start of the series', detect(bars, 'rsi-under-30'), []);
}

section('The 200-day conditions require 20 sessions on the prior side');
{
  // 250 above, then a single close below, then back above.
  const closes = new Array(250).fill(0).map((_, i) => 200 + i * 0.1);
  closes.push(100); // decisively below the average
  for (let i = 0; i < 30; i += 1) closes.push(300);
  const bars = series(closes);
  const lost = detect(bars, 'ma200-lost');
  eq('losing the average after a long run above fires once', lost.length, 1);
  eq('it fires on the bar that closed below', lost[0], 250);
  // Only one session was spent below, so regaining it does not qualify.
  eq('regaining after one session below does not fire', detect(bars, 'ma200-regained'), []);
}
{
  const closes = new Array(250).fill(0).map((_, i) => 200 + i * 0.1);
  for (let i = 0; i < 25; i += 1) closes.push(100); // 25 sessions below
  for (let i = 0; i < 10; i += 1) closes.push(400); // then back above
  const bars = series(closes);
  eq('regaining after 25 sessions below fires once', detect(bars, 'ma200-regained').length, 1);
}

section('Bollinger fires on the bar that leaves the band');
{
  const closes = new Array(40).fill(100);
  closes.push(80, 79, 78); // three closes well outside the lower band
  const bars = series(closes);
  const hits = detect(bars, 'bb-lower');
  eq('one exit is one match', hits.length, 1);
  eq('and it is the first bar outside', hits[0], 40);
}

section('Forward returns truncate rather than zero-fill');
{
  // Entry at index 0, then 10 more bars: horizons 1, 5 and 10 exist; 21 and
  // 42 do not, because those windows have not finished.
  const closes = [100];
  for (let i = 1; i <= 10; i += 1) closes.push(100 + i);
  const bars = series(closes);
  const outcomes = outcomesAt(bars, 0);
  eq('only elapsed horizons are returned', outcomes.map((o) => o.horizon), [1, 5, 10]);
  close('the 10-day return is measured close to close', outcomes[2].ret, 0.1);
  eq('an unfinished window is absent, not flat', outcomes.find((o) => o.horizon === 21), undefined);
}
{
  // A dip inside the window that recovers by the end: the return is positive
  // and the drawdown records the hole anyway.
  const bars = series([100, 90, 95, 96, 97, 105]);
  const five = outcomesAt(bars, 0).find((o) => o.horizon === 5);
  close('return is close to close', five.ret, 0.05);
  close('drawdown records the deepest close inside the window', five.drawdown, -0.1);
}
{
  const bars = series([100, 101, 102, 103, 104, 105]);
  const five = outcomesAt(bars, 0).find((o) => o.horizon === 5);
  eq('a window that never dipped has zero drawdown', five.drawdown, 0);
}

section('Overlap is counted and reported, not silently dropped');
{
  const bars = series(new Array(200).fill(0).map((_, i) => 100 + i));
  // Three matches: two inside 42 sessions of the previous one, one clear of it.
  const matches = buildMatches(bars, [0, 10, 100]);
  eq('the first match never overlaps', matches[0].overlapsPrevious, false);
  eq('a match 10 sessions later overlaps', matches[1].overlapsPrevious, true);
  eq('a match 90 sessions later does not', matches[2].overlapsPrevious, false);
  eq('the honesty count agrees', honestyOf(matches).overlapping, 1);
  eq('the overlap window is the longest horizon', LONGEST, 42);
}

section('Thin and clustered samples are flagged');
{
  const bars = series(new Array(300).fill(0).map((_, i) => 100 + i));
  const thin = honestyOf(buildMatches(bars, [0, 60, 120]));
  eq('three matches is thin', thin.thin, true);
  const wide = honestyOf(buildMatches(bars, Array.from({ length: 12 }, (_, i) => i * 20)));
  eq('twelve matches is not thin', wide.thin, false);
}
{
  const bars = [
    ...['2019-01-01', '2020-01-01', '2020-02-01', '2020-03-01', '2020-04-01'],
  ].map((date, i) => ({ date, open: 100, high: 100, low: 100, close: 100 + i, volume: 0 }));
  const clustered = honestyOf(buildMatches(bars, [0, 1, 2, 3, 4]));
  eq('four of five in one year is flagged', clustered.clusteredYear, { year: '2020', count: 4 });

  const even = honestyOf(buildMatches(bars, [0, 1]));
  eq('an exact half is not a cluster', even.clusteredYear, null);
}

section('Statistics report best and worst beside the median');
{
  // Five matches, spaced clear of each other, with known outcomes at 1 day.
  const closes = [];
  const entries = [];
  const moves = [0.1, -0.2, 0.05, -0.01, 0.02];
  for (const move of moves) {
    entries.push(closes.length);
    closes.push(100, 100 * (1 + move));
    for (let i = 0; i < 60; i += 1) closes.push(100 * (1 + move));
  }
  const bars = series(closes);
  const def = CONDITIONS.find((c) => c.id === 'down-3');
  const result = summarise(def, bars, entries);
  const one = result.horizons.find((h) => h.horizon === 1);

  eq('every match counted at 1 day', one.n, 5);
  close('median is the middle outcome', one.medianReturn, 0.02, 1e-9);
  close('best is the largest', one.bestReturn, 0.1, 1e-9);
  close('worst is the smallest', one.worstReturn, -0.2, 1e-9);
  close('positive share', one.positivePct, 60, 1e-9);
  ok('best and worst name their dates', Boolean(one.bestDate && one.worstDate));
  eq('the match range is reported', [result.firstMatch, result.lastMatch],
    [bars[entries[0]].date, bars[entries[4]].date]);
}

section('Every condition in the brief is present exactly once');
{
  eq('sixteen thresholds across the eight conditions', CONDITIONS.length, 16);
  const ids = CONDITIONS.map((c) => c.id);
  eq('no duplicate ids', new Set(ids).size, ids.length);
  const families = new Set(CONDITIONS.map((c) => c.family));
  eq('eight families', families.size, 8);
  ok('every id detects without throwing', CONDITIONS.every((c) => {
    const bars = series(new Array(400).fill(0).map((_, i) => 100 + Math.sin(i / 5) * 10));
    return Array.isArray(detect(bars, c.id));
  }));
}


section('Episodes are derived from the overlap count, not estimated');
{
  const bars = series(new Array(400).fill(0).map((_, i) => 100 + i));
  // Two clusters: three matches close together, then two more much later.
  const matches = buildMatches(bars, [0, 5, 10, 200, 210]);
  const h = honestyOf(matches);
  eq('three matches inside one window leave three overlapping', h.overlapping, 3);
  eq('two clusters read as two episodes', h.episodes, 2);
  ok(
    'episodes and overlaps account for every match',
    h.episodes + h.overlapping === matches.length,
  );
}
{
  const bars = series(new Array(400).fill(0).map((_, i) => 100 + i));
  const spread = buildMatches(bars, [0, 60, 120, 180, 240]);
  const h = honestyOf(spread);
  eq('matches spaced beyond the window are all independent', h.episodes, 5);
  eq('and none overlap', h.overlapping, 0);
}
{
  eq('no matches means no episodes', honestyOf([]).episodes, 0);
}

section('The baseline covers every window, not just the matches');
{
  // Eleven bars rising 1% a session: every 1-day window is +1%, ten of them.
  const closes = [];
  for (let i = 0; i < 11; i += 1) closes.push(100 * 1.01 ** i);
  const bars = series(closes);

  const one = baselineFor(bars, 1);
  eq('every eligible entry bar is counted', one.n, 10);
  close('median of a constant riser', one.medianReturn, 0.01, 1e-9);
  close('all windows positive', one.positivePct, 100, 1e-9);
  eq('a monotonic riser never draws down', one.medianDrawdown, 0);

  const five = baselineFor(bars, 5);
  eq('the longer horizon has fewer windows', five.n, 6);
  close('five sessions of 1%', five.medianReturn, 1.01 ** 5 - 1, 1e-9);
}
{
  // A steady decline: the baseline must report it, not assume drift up.
  const closes = [];
  for (let i = 0; i < 30; i += 1) closes.push(100 * 0.99 ** i);
  const bars = series(closes);
  const one = baselineFor(bars, 1);
  close('a falling series has a negative baseline', one.medianReturn, -0.01, 1e-9);
  close('and no positive windows', one.positivePct, 0, 1e-9);
  close('drawdown equals the move', one.medianDrawdown, -0.01, 1e-9);
}
{
  const bars = series([100, 101, 102]);
  const long = baselineFor(bars, 42);
  eq('a horizon longer than the series yields nothing', long.n, 0);
  eq('and reports null rather than zero', long.medianReturn, null);
}
{
  const bars = series(new Array(300).fill(0).map((_, i) => 100 + i));
  const all = buildBaseline(bars);
  eq('one baseline per horizon', all.map((b) => b.horizon), [1, 5, 10, 21, 42]);
  ok(
    'each is computed over its own window count',
    all.every((b, i) => i === 0 || b.n < all[i - 1].n),
  );
}
{
  /*
   * The baseline and the condition rows must be measured the same way, or the
   * gap between them is not a comparison. Firing a condition on every eligible
   * bar has to reproduce the baseline exactly.
   */
  const closes = [];
  for (let i = 0; i < 120; i += 1) closes.push(100 + Math.sin(i / 4) * 8 + i * 0.2);
  const bars = series(closes);
  const everyBar = Array.from({ length: bars.length }, (_, i) => i);
  const def = CONDITIONS.find((c) => c.id === 'down-3');
  const asCondition = summarise(def, bars, everyBar);

  for (const horizon of [1, 5, 21]) {
    const b = baselineFor(bars, horizon);
    const c = asCondition.horizons.find((h) => h.horizon === horizon);
    eq(`n agrees at ${horizon}d`, c.n, b.n);
    close(`median agrees at ${horizon}d`, c.medianReturn, b.medianReturn, 1e-12);
    close(`positive share agrees at ${horizon}d`, c.positivePct, b.positivePct, 1e-12);
    close(`median drawdown agrees at ${horizon}d`, c.medianDrawdown, b.medianDrawdown, 1e-12);
  }
}

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`,
);
process.exit(failures === 0 ? 0 : 1);
