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
const { toEpisodes, buildPaths } = await import(
  '../src/lib/analogues/episodes.ts'
);
const { buildRegimes, sessionPasses, parseFilters } = await import(
  '../src/lib/analogues/regimes.ts'
);
const { applyFilters, baselineOver, episodesUnder, MIN_EPISODES } =
  await import('../src/lib/analogues/filtered.ts');
const {
  comparisonSentence, overlapSentence, verdictFor, horizonLabel,
  SMALL_GAP_PP, CLEAR_GAP_PP, MEANINGFUL_GAP_PP, POSITIVE_DEADBAND_PP,
} = await import('../src/lib/analogues/phrasing.ts');

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


section('Episodes are anchored, never chained off the previous match');
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
  /*
   * The regression this whole section exists for.
   *
   * Sixty matches spaced ten sessions apart. Chaining off the previous match
   * calls that ONE episode, because no single gap reaches 42 — which is how
   * SPY ended up reporting 624 three-up-closes as 8 independent readings, with
   * one "stretch" running from 2010 to 2022. Anchoring gives one observation
   * per 42 sessions, which is what the number is supposed to mean.
   */
  const bars = series(new Array(900).fill(0).map((_, i) => 100 + i));
  const dense = Array.from({ length: 60 }, (_, i) => i * 10);
  const matches = buildMatches(bars, dense);
  const episodes = toEpisodes(matches);

  ok('a dense run is not one episode', episodes.length > 1,
    `got ${episodes.length}`);
  // Matches at 0,10,...,590. Anchors at 0,42*k rounded up to a match: every
  // fifth match, so 0,50,100,... up to 550 — twelve of them.
  eq('it is one observation per window', episodes.length, 12);
  eq('and the honesty count agrees', honestyOf(matches).episodes, 12);
}
{
  /*
   * The structural invariant, asserted over a spread of spacings. Anchors must
   * be at least a full window apart and no episode may span a window, or the
   * count is not measuring independence at all.
   */
  const bars = series(new Array(2000).fill(0).map((_, i) => 100 + i));
  for (const spacing of [1, 3, 7, 13, 41, 42, 43, 90]) {
    const idx = [];
    for (let i = 0; i < 1500; i += spacing) idx.push(i);
    const matches = buildMatches(bars, idx);
    const episodes = toEpisodes(matches);
    const anchors = episodes.map((e) => e.anchorIndex);

    let minGap = Infinity;
    for (let i = 1; i < anchors.length; i += 1) {
      minGap = Math.min(minGap, anchors[i] - anchors[i - 1]);
    }
    ok(`anchors stay a window apart at spacing ${spacing}`,
      anchors.length < 2 || minGap >= LONGEST, `min gap ${minGap}`);

    // Every member of an episode must sit inside its anchor's own window.
    const byIndex = new Map(matches.map((m) => [m.index, m]));
    let widest = 0;
    for (let i = 0; i < episodes.length; i += 1) {
      const start = episodes[i].anchorIndex;
      const endIdx = byIndex.get(
        idx.filter((x) => x >= start && (i + 1 === episodes.length
          || x < episodes[i + 1].anchorIndex)).pop(),
      ).index;
      widest = Math.max(widest, endIdx - start);
    }
    ok(`no episode spans a whole window at spacing ${spacing}`,
      widest < LONGEST, `widest span ${widest}`);
  }
}
{
  /*
   * A denser pattern can never yield fewer independent observations than a
   * sparser one drawn from the same window. Chaining broke exactly this: 3-up
   * reported 8 episodes against 4-up's 61, and a subset cannot out-count its
   * superset.
   */
  const bars = series(new Array(1200).fill(0).map((_, i) => 100 + i));
  const sparse = [];
  for (let i = 0; i < 1000; i += 30) sparse.push(i);
  const dense = [];
  for (let i = 0; i < 1000; i += 10) dense.push(i);
  ok('every sparse match is also a dense match',
    sparse.every((i) => dense.includes(i)));

  const sparseEpisodes = honestyOf(buildMatches(bars, sparse)).episodes;
  const denseEpisodes = honestyOf(buildMatches(bars, dense)).episodes;
  ok('so the denser pattern cannot have fewer episodes',
    denseEpisodes >= sparseEpisodes,
    `dense ${denseEpisodes} < sparse ${sparseEpisodes}`);
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


section('The generated read quotes both numbers and never implies action');
{
  /*
   * A condition result assembled by hand, so the wording at each size of gap
   * is pinned. Building it from a real series would make the sentence depend
   * on the detectors, which are tested separately.
   */
  const make = (medianReturn, n = 40, thin = false, label = '3 consecutive down closes') => ({
    id: 'down-3',
    label,
    rule: '',
    family: 'consecutive-down',
    matches: new Array(n).fill(0).map((_, k) => ({
      date: `2000-01-${String((k % 28) + 1).padStart(2, '0')}`,
      index: k, close: 100, outcomes: [], overlapsPrevious: false,
    })),
    firstMatch: '2000-01-01',
    lastMatch: '2000-01-28',
    activeToday: false,
    horizons: [
      { horizon: 1, n, medianReturn: 0.001, bestReturn: 0.01, worstReturn: -0.01,
        bestDate: null, worstDate: null, positivePct: 50, medianDrawdown: 0, worstDrawdown: 0 },
      { horizon: 42, n, medianReturn, bestReturn: 0.2, worstReturn: -0.2,
        bestDate: null, worstDate: null, positivePct: 60, medianDrawdown: -0.02, worstDrawdown: -0.3 },
    ],
    honesty: { thin, overlapping: 0, episodes: n, clusteredYear: null },
  });

  const baseline = [
    { horizon: 1, n: 8000, medianReturn: 0.0005, positivePct: 52, medianDrawdown: 0 },
    { horizon: 42, n: 8000, medianReturn: 0.0218, positivePct: 67, medianDrawdown: -0.026 },
  ];

  // Gap of +0.31pp: the real SPY down-3 case.
  const small = comparisonSentence(make(0.0249), baseline);
  eq('it speaks about the longest usable horizon', small.horizon, 42);
  ok('it quotes the pattern result', small.text.includes('+2.5%'));
  ok('it quotes the every-other-day result', small.text.includes('+2.2%'));
  ok('it names the condition mid-sentence',
    small.text.startsWith('After 3 consecutive down closes,'));
  ok('a sub-half-point gap is called little difference',
    small.text.includes('Little difference between the two.'), small.text);
  ok('without an episode count it falls back to days',
    small.text.includes('across 40 days'), small.text);
  ok('given episodes it counts in stretches instead',
    comparisonSentence(make(0.0249), baseline, 7).text
      .includes('across 7 separate stretches'),
    comparisonSentence(make(0.0249), baseline, 7).text);
  ok('and reads singular correctly',
    comparisonSentence(make(0.0249), baseline, 1).text
      .includes('across 1 separate stretch.'),
    comparisonSentence(make(0.0249), baseline, 1).text);
  ok('it says normal day rather than a random window',
    small.text.includes('On a normal day it came to'), small.text);
  ok('no jargon survives in the generated read',
    !/median|baseline|drawdown|horizon/i.test(small.text), small.text);

  const clear = comparisonSentence(make(0.0518), baseline);
  ok('a three-point gap is stated plainly',
    clear.text.includes('came out clearly ahead.'), clear.text);
  ok('and is not called a little', !clear.text.includes('a little ahead'));

  const middling = comparisonSentence(make(0.0318), baseline);
  ok('a one-point gap is called a little ahead',
    middling.text.includes('came out a little ahead.'), middling.text);

  const negative = comparisonSentence(make(-0.0182), baseline);
  ok('a negative gap says behind',
    negative.text.includes('came out clearly behind.'), negative.text);
  ok('and quotes the losing figure', negative.text.includes('-1.8%'), negative.text);

  const thinOne = comparisonSentence(make(0.09, 5, true), baseline);
  ok('a thin sample gets no verdict on the gap size',
    thinOne.text.includes('Too few past examples here to tell either way.'),
    thinOne.text);
  ok('and still quotes both figures',
    thinOne.text.includes('+9.0%') && thinOne.text.includes('+2.2%'));

  const acronym = comparisonSentence(make(0.0249, 40, false, 'RSI(14) closes below 30'), baseline);
  ok('an acronym label is not lower-cased',
    acronym.text.startsWith('After RSI(14) closes below 30,'), acronym.text);

  // The whole point of the module: nothing that reads as instruction.
  const forbidden = [
    'buy', 'sell', 'should', 'recommend', 'signal', 'opportunity', 'edge',
    'suggests', 'expect', 'likely to', 'p-value', 'significant',
  ];
  for (const sentence of [small, clear, middling, negative, thinOne, acronym]) {
    const lower = sentence.text.toLowerCase();
    const hit = forbidden.find((w) => lower.includes(w));
    ok(`no action language: ${JSON.stringify(sentence.text.slice(0, 40))}`, !hit, `found ${hit}`);
  }

  eq('thresholds are the documented ones', [SMALL_GAP_PP, CLEAR_GAP_PP], [0.5, 1.5]);
}
{
  const empty = {
    id: 'down-3', label: 'x', rule: '', family: 'consecutive-down',
    matches: [], firstMatch: null, lastMatch: null, activeToday: false,
    horizons: [], honesty: { thin: true, overlapping: 0, episodes: 0, clusteredYear: null },
  };
  eq('no matches means no sentence', comparisonSentence(empty, []), null);
  eq('and no overlap line', overlapSentence(empty), null);
}

section('The overlap line names the condition and leads with episodes');
{
  const condition = {
    id: 'down-3', label: '3 consecutive down closes', rule: '',
    family: 'consecutive-down',
    matches: new Array(448).fill(0).map((_, k) => ({
      date: '2000-01-01', index: k, close: 100, outcomes: [], overlapsPrevious: k > 36,
    })),
    firstMatch: null, lastMatch: null, activeToday: false,
    horizons: [],
    honesty: { thin: false, overlapping: 411, episodes: 37, clusteredYear: null },
  };
  const line = overlapSentence(condition);
  eq('it reads in plain words', line,
    'This happened 448 times, but they came in clumps — about 37 separate '
    + 'stretches. So it is really 37 stories, not 448.');
  ok('no action language', !/buy|sell|should/i.test(line));
}
{
  const one = {
    id: 'x', label: 'A rare thing', rule: '', family: 'gap',
    matches: [{ date: '2000-01-01', index: 0, close: 1, outcomes: [], overlapsPrevious: false },
              { date: '2000-01-02', index: 1, close: 1, outcomes: [], overlapsPrevious: true }],
    firstMatch: null, lastMatch: null, activeToday: false, horizons: [],
    honesty: { thin: true, overlapping: 1, episodes: 1, clusteredYear: null },
  };
  ok('singular stretch reads correctly',
    overlapSentence(one).includes('about 1 separate stretch.'), overlapSentence(one));
  ok('and singular story', overlapSentence(one).includes('really 1 story, not 2'));
}


section('The headline verdict has three shapes and never implies action');
{
  const make = (medianReturn, positivePct, n = 40, thin = false) => ({
    id: 'down-3', label: '3 consecutive down closes', rule: '',
    family: 'consecutive-down',
    matches: new Array(n).fill(0).map((_, k) => ({
      date: '2000-01-01', index: k, close: 100, outcomes: [], overlapsPrevious: false,
    })),
    firstMatch: null, lastMatch: null, activeToday: false,
    horizons: [
      { horizon: 42, n, medianReturn, bestReturn: 0.2, worstReturn: -0.2,
        bestDate: null, worstDate: null, positivePct, medianDrawdown: -0.02,
        worstDrawdown: -0.3 },
    ],
    honesty: { thin, overlapping: 0, episodes: n, clusteredYear: null },
  });
  const baseline = [
    { horizon: 42, n: 8413, medianReturn: 0.0218, positivePct: 67, medianDrawdown: -0.026 },
  ];

  const nothing = verdictFor(make(0.0249, 70), baseline);
  eq('a +0.3 point gap is the nothing shape', nothing.tone, 'nothing');
  eq('with the specified wording', nothing.text, 'Nothing special happened after this.');
  eq('and its second line names the usual rate', nothing.detail,
    'The market went up 70% of the time — about the same as it usually does.');

  const better = verdictFor(make(0.0642, 79), baseline);
  eq('a +4.2 point gap is better', better.tone, 'better');
  eq('with the specified wording', better.text,
    'The market usually did better than normal after this.');
  eq('and its second line compares the two rates', better.detail,
    'It went up 79% of the time, against 67% on a normal day.');

  const worse = verdictFor(make(0.0086, 57), baseline);
  eq('a -1.3 point gap is not yet worse', worse.tone, 'nothing');
  const clearlyWorse = verdictFor(make(0.0018, 57), baseline);
  eq('a -2.0 point gap is worse', clearlyWorse.tone, 'worse');
  eq('with the specified wording', clearlyWorse.text,
    'The market usually did worse than normal after this.');

  // Exactly on the threshold counts as meaningful, in both directions.
  eq('the threshold is inclusive going up',
    verdictFor(make(0.0218 + MEANINGFUL_GAP_PP / 100, 70), baseline).tone, 'better');
  eq('and inclusive going down',
    verdictFor(make(0.0218 - MEANINGFUL_GAP_PP / 100, 60), baseline).tone, 'worse');

  /*
   * The mixed case. The headline declines to pick a side; the dedicated
   * section below covers the wording. Asserted here too so the three-shape
   * block cannot drift back to resolving a contradiction silently.
   */
  const mixed = verdictFor(make(0.0487, 61), baseline);
  eq('a mixed condition picks neither side', mixed.tone, 'nothing');
  eq('and carries the percent-positive that disagrees', mixed.condPositive, 61);
  eq('beside the baseline it disagrees with', mixed.basePositive, 67);

  const thinOne = verdictFor(make(0.09, 90, 5, true), baseline);
  eq('a thin sample never earns better', thinOne.tone, 'nothing');
  eq('and says why', thinOne.text,
    'This has only happened 5 times — too few to tell.');

  const forbidden = ['buy', 'sell', 'should', 'recommend', 'signal',
    'opportunity', 'edge', 'suggests', 'expect', 'p-value', 'significant'];
  for (const v of [nothing, better, clearlyWorse, mixed, thinOne]) {
    const lower = v.text.toLowerCase();
    ok(`no action language in ${JSON.stringify(v.tone)}`,
      !forbidden.some((w) => lower.includes(w)));
  }
  eq('the stated threshold is the one used', MEANINGFUL_GAP_PP, CLEAR_GAP_PP);
}
{
  const empty = {
    id: 'x', label: 'x', rule: '', family: 'gap', matches: [],
    firstMatch: null, lastMatch: null, activeToday: false, horizons: [],
    honesty: { thin: true, overlapping: 0, episodes: 0, clusteredYear: null },
  };
  eq('no matches means no verdict', verdictFor(empty, []), null);
}

section('Periods read in the reader units');
{
  eq('1 session', horizonLabel(1), '1 day');
  eq('5 sessions', horizonLabel(5), '1 week');
  eq('10 sessions', horizonLabel(10), '2 weeks');
  eq('21 sessions', horizonLabel(21), '1 month');
  eq('42 sessions', horizonLabel(42), '2 months');
  eq('anything else falls back to sessions', horizonLabel(7), '7 sessions');
}


section('When the two measures disagree the headline picks neither');
{
  const make = (medianReturn, positivePct, n = 40, thin = false) => ({
    id: 'dd-10', label: 'Drawdown crosses -10%', rule: '', family: 'drawdown',
    matches: new Array(n).fill(0).map((_, k) => ({
      date: '2000-01-01', index: k, close: 100, outcomes: [], overlapsPrevious: false,
    })),
    firstMatch: null, lastMatch: null, activeToday: false,
    horizons: [
      { horizon: 42, n, medianReturn, bestReturn: 0.2, worstReturn: -0.2,
        bestDate: null, worstDate: null, positivePct, medianDrawdown: -0.04,
        worstDrawdown: -0.3 },
    ],
    honesty: { thin, overlapping: 0, episodes: n, clusteredYear: null },
  });
  const baseline = [
    { horizon: 42, n: 8413, medianReturn: 0.0218, positivePct: 67, medianDrawdown: -0.026 },
  ];

  // The real SPY drawdown -10% shape: median well above, went up less often.
  const mixed = verdictFor(make(0.0487, 61), baseline);
  eq('the headline refuses to pick a side', mixed.tone, 'nothing');
  eq('and says why', mixed.text,
    'This one is mixed — the numbers point different ways.');
  eq('the disagreement is stated plainly', mixed.detail,
    'Its typical result was better than normal, but it went up less often — ' +
    '61% of the time, against 67% on a normal day.');

  // The mirror: median well below, went up more often.
  const mirrored = verdictFor(make(0.0018, 74), baseline);
  eq('the mirrored case also refuses', mirrored.tone, 'nothing');
  eq('and reads the other way round', mirrored.detail,
    'Its typical result was worse than normal, but it went up more often — ' +
    '74% of the time, against 67% on a normal day.');

  // Agreement is untouched: both above.
  const agree = verdictFor(make(0.0642, 79), baseline);
  eq('agreement still earns better', agree.tone, 'better');
  ok('and its second line is the ordinary comparison',
    agree.detail.startsWith('It went up 79% of the time, against 67%'), agree.detail);

  const agreeWorse = verdictFor(make(0.0018, 60), baseline);
  eq('agreement still earns worse', agreeWorse.tone, 'worse');
  ok('with the ordinary second line',
    agreeWorse.detail.includes('against 67% on a normal day'), agreeWorse.detail);

  /*
   * A median gap too small to pick a side never raises a disagreement, however
   * the percent-positive falls. Announcing a contradiction between two flat
   * numbers would be noise, and four of SPY's conditions sit there.
   */
  const flat = verdictFor(make(0.0225, 60), baseline);
  eq('a sub-threshold typical result raises no disagreement', flat.text,
    'Nothing special happened after this.');
  ok('and its second line says about the same',
    flat.detail.includes('about the same as it usually does'), flat.detail);

  // Percent-positive inside the deadband is not a direction.
  const withinDeadband = verdictFor(make(0.0487, 66.5), baseline);
  eq('a sub-point positive gap does not count as disagreeing',
    withinDeadband.tone, 'better');
  ok('and reads as an ordinary better',
    withinDeadband.text === 'The market usually did better than normal after this.');
  eq('the deadband is the documented one', POSITIVE_DEADBAND_PP, 1);

  // Thin still wins over everything.
  const thinMixed = verdictFor(make(0.0487, 61, 5, true), baseline);
  eq('a thin sample still reports too few examples', thinMixed.text,
    'This has only happened 5 times — too few to tell.');

  const forbidden = ['buy', 'sell', 'should', 'recommend', 'signal',
    'opportunity', 'edge', 'suggests', 'expect', 'p-value', 'significant'];
  for (const v of [mixed, mirrored]) {
    const text = `${v.text} ${v.detail}`.toLowerCase();
    ok('no action language in the mixed wording',
      !forbidden.some((w) => text.includes(w)));
  }

  /*
   * The words the brief bans outright from the headline and its second line.
   * They are correct terms and they stay in "How this is calculated"; what is
   * not allowed is meeting one before the answer.
   */
  const banned = ['baseline', 'median', 'random day', 'percentage point',
    'statistical', 'distribution', 'sample'];
  for (const v of [mixed, mirrored, thinMixed, agree, agreeWorse, withinDeadband]) {
    const text = `${v.text} ${v.detail}`.toLowerCase();
    const hit = banned.find((w) => text.includes(w));
    ok(`no jargon in ${JSON.stringify(v.text.slice(0, 34))}`, !hit, `found ${hit}`);
  }
}


section('Episodes group occurrences into the stretches they came from');
{
  const bars = series(new Array(400).fill(0).map((_, i) => 100 + i));
  // Two clusters and one loner: 0,5,10 | 200,210 | 350
  const matches = buildMatches(bars, [0, 5, 10, 200, 210, 350]);
  const episodes = toEpisodes(matches);
  eq('three stretches', episodes.length, 3);
  eq('day zero anchors at the FIRST of each run',
    episodes.map((e) => e.anchorIndex), [0, 200, 350]);
  eq('and each knows how many occurrences it holds',
    episodes.map((e) => e.occurrences), [3, 2, 1]);
  eq('the episode count agrees with the honesty count',
    episodes.length, honestyOf(matches).episodes);
}
{
  eq('no matches means no episodes', toEpisodes([]).length, 0);
}

section('Paths are rebased per episode and never smoothed');
{
  // Flat 100, then one episode that doubles over its window.
  const closes = new Array(60).fill(100);
  for (let i = 0; i < 60; i += 1) closes.push(100 + i);
  const bars = series(closes);
  const matches = buildMatches(bars, [60]);
  const view = buildPaths(bars, toEpisodes(matches));

  eq('one episode draws one line', view.paths.length, 1);
  close('every path starts at exactly 100', view.paths[0].values[0], 100, 1e-9);
  eq('and runs to the longest horizon', view.paths[0].values.length, LONGEST + 1);
  close('the value is a rebase of the close',
    view.paths[0].values[10], ((100 + 10) / 100) * 100, 1e-9);
}
{
  /*
   * Three episodes finishing at 90, 100 and 130. The median must be the
   * middle one and the extremes must survive untouched — a chart that
   * clipped the 130 would answer a different question.
   */
  const closes = [];
  const anchors = [];
  for (const end of [0.9, 1.0, 1.3]) {
    anchors.push(closes.length);
    closes.push(100);
    for (let d = 1; d <= LONGEST; d += 1) {
      closes.push(100 * (1 + (end - 1) * (d / LONGEST)));
    }
    for (let k = 0; k < 60; k += 1) closes.push(100 * end);
  }
  const bars = series(closes);
  const view = buildPaths(bars, toEpisodes(buildMatches(bars, anchors)));

  eq('three separate stretches', view.paths.length, 3);
  const last = view.band[view.band.length - 1];
  eq('the band runs to the longest horizon', last.day, LONGEST);
  close('the median finish is the middle episode', last.median, 100, 1e-6);
  close('the band holds the middle half', last.p25, 95, 1e-6);
  close('on both sides', last.p75, 115, 1e-6);
  ok('the winner is not clipped',
    Math.max(...view.paths.map((p) => p.endValue)) > 129);
  ok('nor the loser', Math.min(...view.paths.map((p) => p.endValue)) < 91);
}

section('Regime filters state their own reach');
{
  const closes = new Array(400).fill(0).map((_, i) => 100 + Math.sin(i / 9) * 6 + i * 0.05);
  const bars = series(closes);
  const vix = new Map(bars.map((b, i) => [b.date, 10 + (i % 30)]));
  const { rows, filters } = buildRegimes(bars, vix);

  eq('one regime row per session', rows.length, bars.length);
  eq('the 50-day is undefined before it exists', rows[10].ma50, null);
  ok('and defined once it does', rows[80].ma50 !== null);
  eq('the 200-day is undefined before it exists', rows[100].ma200, null);
  ok('and defined once it does', rows[250].ma200 !== null);

  const ma50 = filters.find((f) => f.id === 'ma50');
  ok('the 50-day filter names the date it starts from', Boolean(ma50.from));
  ok('and says so in words', ma50.note.includes(ma50.from));

  const gamma = filters.find((f) => f.id === 'gamma');
  eq('gamma is unavailable', gamma.available, false);
  eq('and offers no start date', gamma.from, null);
  ok('and says why in plain words',
    gamma.note.startsWith('Unavailable.') && gamma.note.includes('backfill'),
    gamma.note);
}
{
  // No VIX at all: the filter turns off, the rest keep working.
  const bars = series(new Array(400).fill(0).map((_, i) => 100 + i));
  const { filters, rows } = buildRegimes(bars, null);
  const vixFilter = filters.find((f) => f.id === 'vix');
  eq('the VIX filter is unavailable without VIX', vixFilter.available, false);
  eq('and no session carries a bucket', rows[300].vix, null);
  ok('while the moving averages still work', rows[300].ma200 !== null);
}
{
  const bars = series(new Array(400).fill(0).map((_, i) => 100 + i));
  const { filters } = buildRegimes(bars, null);
  eq('unavailable filters are ignored from the URL',
    parseFilters({ gamma: 'positive', vix: 'high' }, filters), {});
  eq('and unknown values are dropped',
    parseFilters({ ma200: 'sideways' }, filters), {});
  eq('a good value is kept',
    parseFilters({ ma200: 'above' }, filters), { ma200: 'above' });
}
{
  eq('a session with no regime never passes',
    sessionPasses(undefined, { ma200: 'above' }), false);
  eq('nor one the filter cannot classify',
    sessionPasses({ ma50: null, ma200: null, vix: null }, { ma200: 'above' }), false);
  eq('everything passes when nothing is applied',
    sessionPasses({ ma50: null, ma200: null, vix: null }, {}), true);
  eq('gamma excludes everything, since it has no series',
    sessionPasses({ ma50: 'above', ma200: 'above', vix: 'low' }, { gamma: 'positive' }),
    false);
}

section('The floor withholds returns rather than hedging them');
{
  const bars = series(new Array(900).fill(0).map((_, i) => 100 + Math.sin(i / 7) * 5 + i * 0.05));
  const { rows } = buildRegimes(bars, null);
  const def = CONDITIONS.find((c) => c.id === 'down-3');

  // Twelve well-separated occurrences: over the floor.
  const many = buildMatches(bars, Array.from({ length: 12 }, (_, i) => 300 + i * 45));
  const wide = applyFilters(def, bars, many, rows, {});
  eq('twelve stretches clear the floor', wide.episodes, 12);
  eq('so results are shown', wide.tooThin, false);
  ok('with a table', wide.result !== null);
  ok('a comparison row', wide.baseline !== null);
  ok('and paths', wide.paths !== null);

  // Nine: under the floor.
  const few = buildMatches(bars, Array.from({ length: 9 }, (_, i) => 300 + i * 45));
  const thin = applyFilters(def, bars, few, rows, {});
  eq('nine stretches do not', thin.episodes, 9);
  eq('so it is marked too thin', thin.tooThin, true);
  eq('and NOTHING is returned to display', thin.result, null);
  eq('not even a comparison row', thin.baseline, null);
  eq('nor paths', thin.paths, null);
  ok('but the count is still reported', thin.episodes === 9);
  eq('the floor is the documented one', MIN_EPISODES, 10);
}
{
  /*
   * Occurrences clumped inside one window are one stretch, so a condition
   * that fired thirty times can still be under the floor. This is the case
   * the floor exists for.
   */
  const bars = series(new Array(600).fill(0).map((_, i) => 100 + i));
  const { rows } = buildRegimes(bars, null);
  const def = CONDITIONS.find((c) => c.id === 'down-3');
  const clumped = buildMatches(bars, Array.from({ length: 30 }, (_, i) => 100 + i));
  const out = applyFilters(def, bars, clumped, rows, {});
  eq('thirty clumped days are one stretch', out.episodes, 1);
  eq('and are withheld', out.tooThin, true);
}

section('A filtered comparison uses filtered days, not all history');
{
  const bars = series(new Array(1100).fill(0).map((_, i) => 100 + i * 0.4));
  const { rows } = buildRegimes(bars, null);

  const above = [];
  const all = [];
  for (let i = 0; i < bars.length; i += 1) {
    all.push(i);
    if (sessionPasses(rows[i], { ma200: 'above' })) above.push(i);
  }
  ok('the filter selects a strict subset', above.length > 0 && above.length < all.length);

  const filteredRow = baselineOver(bars, above);
  const everything = baselineOver(bars, all);
  const oneFiltered = filteredRow.find((b) => b.horizon === 1);
  const oneAll = everything.find((b) => b.horizon === 1);
  ok('and the comparison row rests on fewer days', oneFiltered.n < oneAll.n);
  ok('while still measuring something', oneFiltered.n > 0);

  const def = CONDITIONS.find((c) => c.id === 'down-3');
  const matches = buildMatches(bars, Array.from({ length: 14 }, (_, i) => 250 + i * 45));
  const out = applyFilters(def, bars, matches, rows, { ma200: 'above' });
  if (!out.tooThin) {
    ok('the filtered view reports the days its comparison used',
      out.baselineDays === above.length,
      `expected ${above.length}, got ${out.baselineDays}`);
    const shown = out.baseline.find((b) => b.horizon === 1);
    eq('and that comparison is the filtered one', shown.n, oneFiltered.n);
  }
}
{
  // Episode counting under a candidate filter, for the number on each button.
  const bars = series(new Array(1100).fill(0).map((_, i) => 100 + i * 0.4));
  const { rows } = buildRegimes(bars, null);
  const matches = buildMatches(bars, Array.from({ length: 14 }, (_, i) => 250 + i * 45));
  const unfiltered = episodesUnder(bars, matches, rows, {});
  const narrowed = episodesUnder(bars, matches, rows, { ma200: 'below' });
  eq('unfiltered counts every stretch', unfiltered, 14);
  ok('and a filter can only shrink it', narrowed <= unfiltered);
}

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`,
);
process.exit(failures === 0 ? 0 : 1);
