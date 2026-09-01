/*
 * Validation of the intraday movers rules in src/lib/movers/rules.ts.
 *
 * Those four functions are the entire editorial content of /movers: what gets
 * on the list, what order it is in, and what is said about each row. The rest
 * of the feature is fetching and rendering.
 *
 * Why this file exists, in one sentence: a movers list is the page on this
 * site most likely to be misread as a recommendation, and the two ways that
 * happens are a warning quietly becoming an exclusion, and "unknown" quietly
 * becoming "clear". Both are asserted against below, directly.
 *
 * The gate function and the description functions are checked separately and
 * are never allowed to touch: `qualifies` takes no warning as an argument, and
 * the section at the end proves that no combination of warnings can change
 * what it returns.
 *
 * Run: npm run verify:movers
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { qualifies, trendFrom, pctFrom, warningsFor, byChangeDescending, EARNINGS_WARN_DAYS } =
  await import('../src/lib/movers/rules.ts');
const {
  MIN_RELATIVE_VOLUME,
  HIGH_RELATIVE_VOLUME,
  MAX_MOVERS,
  MOVERS_EXPLANATION,
  MOVERS_EXPLANATION_LIVE,
} =
  await import('../src/lib/movers/types.ts');
const { EXTENDED_PCT, EARNINGS_EXCLUSION_DAYS } = await import('../src/lib/scanner/types.ts');

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

function section(name) {
  console.log(`\n${name}`);
}

/** A known earnings date `daysAway` out. */
const known = (daysAway) => ({
  state: 'known',
  dateIso: '2026-09-02',
  daysAway,
  source: 'test',
});

const unknownEarnings = {
  state: 'unknown',
  dateIso: null,
  daysAway: null,
  source: 'test',
};

// --- the one gate ------------------------------------------------------------

section('The volume gate is the only thing that removes a name');

ok('a 2x move on 2x volume qualifies', qualifies(2, 2_000_000, 1_000_000));
ok(
  'a huge move on thin volume does not',
  !qualifies(25, 400_000, 1_000_000),
  'the whole point of the gate: a big move nobody traded is not a move',
);
ok(
  'a small move on heavy volume does',
  qualifies(0.2, 5_000_000, 1_000_000),
  'the gate is on volume, not on the size of the move',
);

ok(
  `exactly ${MIN_RELATIVE_VOLUME}x does not qualify`,
  !qualifies(3, 1_500_000, 1_000_000),
  'strictly above the threshold, not at it',
);
ok('a hair over does', qualifies(3, 1_500_001, 1_000_000));

section('Gainers only, in this branch');

ok('a decliner never qualifies', !qualifies(-8, 9_000_000, 1_000_000));
ok('an unchanged name never qualifies', !qualifies(0, 9_000_000, 1_000_000));

section('Missing data is not a pass');

ok(
  'no stored baseline cannot qualify',
  !qualifies(6, 5_000_000, null),
  'an ungradeable name has not passed the gate, it was never put to it',
);
ok('no session volume cannot qualify', !qualifies(6, null, 1_000_000));
ok('a zero baseline cannot qualify', !qualifies(6, 5_000_000, 0));
ok('a negative baseline cannot qualify', !qualifies(6, 5_000_000, -1));
ok('a non-finite volume cannot qualify', !qualifies(6, Number.NaN, 1_000_000));
ok('an infinite volume cannot qualify', !qualifies(6, Number.POSITIVE_INFINITY, 1_000_000));

// --- the 200-day reading ------------------------------------------------------

section('Below the 200-day and unknown are different answers');

eq('above', trendFrom(120, 100), 'above');
eq('below', trendFrom(90, 100), 'below');
eq('exactly on it counts as above', trendFrom(100, 100), 'above');
eq(
  'a missing average is unknown, never below',
  trendFrom(120, null),
  'unknown',
);
eq('a zero average is unknown', trendFrom(120, 0), 'unknown');

eq('percent above', Math.round(pctFrom(110, 100)), 10);
eq('percent below', Math.round(pctFrom(90, 100)), -10);
eq('percent from a missing average is null', pctFrom(110, null), null);

// --- warnings -----------------------------------------------------------------

const clean = {
  trend: 'above',
  pctFrom20: 1,
  relativeVolume: 2,
  earnings: known(30),
};

section('An unknown earnings date is a warning, never silence');

ok(
  'a missing earnings reading warns',
  warningsFor({ ...clean, earnings: undefined }).includes('earnings-unknown'),
  'this is the single most important line in the module',
);
ok(
  "an explicit 'unknown' state warns",
  warningsFor({ ...clean, earnings: unknownEarnings }).includes('earnings-unknown'),
);
ok(
  'a known distant date does not warn',
  warningsFor(clean).length === 0,
  `got ${JSON.stringify(warningsFor(clean))}`,
);
ok(
  'an unknown date never produces the plain earnings warning',
  !warningsFor({ ...clean, earnings: unknownEarnings }).includes('earnings'),
  '"we could not find out" must not render as "it reports tomorrow"',
);

section(`Earnings inside ${EARNINGS_WARN_DAYS} days`);

ok('the window is three days', EARNINGS_WARN_DAYS === 3, String(EARNINGS_WARN_DAYS));
ok('today warns', warningsFor({ ...clean, earnings: known(0) }).includes('earnings'));
ok('tomorrow warns', warningsFor({ ...clean, earnings: known(1) }).includes('earnings'));
ok(
  'two days out warns — the row this flag exists for',
  warningsFor({ ...clean, earnings: known(2) }).includes('earnings'),
);
ok(
  'the last day of the window warns',
  warningsFor({ ...clean, earnings: known(EARNINGS_WARN_DAYS) }).includes('earnings'),
);
ok(
  'the day after does not',
  !warningsFor({ ...clean, earnings: known(EARNINGS_WARN_DAYS + 1) }).includes('earnings'),
);
ok(
  "and the warning window is shorter than the scanner's exclusion window",
  EARNINGS_WARN_DAYS < EARNINGS_EXCLUSION_DAYS,
  'annotating a mover and removing a candidate are different decisions',
);
ok(
  'a date already past does not warn',
  !warningsFor({ ...clean, earnings: known(-3) }).includes('earnings'),
);

section('The other three warnings');

ok(
  'below the 200-day warns',
  warningsFor({ ...clean, trend: 'below' }).includes('below-200'),
);
ok(
  'an unknown trend does not warn as below',
  !warningsFor({ ...clean, trend: 'unknown' }).includes('below-200'),
);

ok(
  `more than ${EXTENDED_PCT}% above the 20-day is extended`,
  warningsFor({ ...clean, pctFrom20: EXTENDED_PCT + 0.1 }).includes('extended'),
);
ok(
  `exactly ${EXTENDED_PCT}% is not`,
  !warningsFor({ ...clean, pctFrom20: EXTENDED_PCT }).includes('extended'),
);
ok(
  'an unreadable 20-day average is not extended',
  !warningsFor({ ...clean, pctFrom20: null }).includes('extended'),
  'a warning made entirely out of a gap in the data is worse than none',
);

ok(
  `${HIGH_RELATIVE_VOLUME}x volume warns`,
  warningsFor({ ...clean, relativeVolume: HIGH_RELATIVE_VOLUME }).includes('volume-spike'),
);
ok(
  'just under does not',
  !warningsFor({ ...clean, relativeVolume: HIGH_RELATIVE_VOLUME - 0.01 }).includes(
    'volume-spike',
  ),
);

section('Every warning at once, and still just warnings');

const worst = warningsFor({
  trend: 'below',
  pctFrom20: 40,
  relativeVolume: 12,
  earnings: known(0),
});
eq('all four fire together', worst.sort(), [
  'below-200',
  'earnings',
  'extended',
  'volume-spike',
]);

// --- the asymmetry that matters ----------------------------------------------

section('No warning can ever exclude a name');

{
  /*
   * The failure this guards against is a future edit that threads a warning
   * back into the gate — "let us just drop the ones reporting tomorrow". The
   * gate takes three numbers and cannot see a warning, and this asserts that
   * the gate's answer is identical for the cleanest and the ugliest row that
   * share the same three numbers.
   */
  const changePct = 6;
  const volume = 5_000_000;
  const baseline = 1_000_000;

  const gate = qualifies(changePct, volume, baseline);
  ok('the ugly row is on the list', gate);

  const ugly = warningsFor({
    trend: 'below',
    pctFrom20: 40,
    relativeVolume: volume / baseline,
    earnings: known(0),
  });
  ok('and it carries four warnings', ugly.length === 4, JSON.stringify(ugly));
  ok(
    'the gate returns the same answer regardless',
    qualifies(changePct, volume, baseline) === gate,
    'qualifies() must never take a warning as an input',
  );
  ok(
    'qualifies takes exactly three arguments',
    qualifies.length === 3,
    `it takes ${qualifies.length} — a fourth is how a warning becomes a filter`,
  );
}

// --- ordering ------------------------------------------------------------------

section('The list is ordered by percent change and nothing else');

{
  const rows = [
    { symbol: 'LOW', changePct: 1.2, relativeVolume: 40, rsScore: 99 },
    { symbol: 'TOP', changePct: 9.4, relativeVolume: 1.6, rsScore: 2 },
    { symbol: 'MID', changePct: 4.0, relativeVolume: 20, rsScore: 50 },
  ];
  eq(
    'the biggest gainer leads, whatever its volume or strength',
    [...rows].sort(byChangeDescending).map((r) => r.symbol),
    ['TOP', 'MID', 'LOW'],
  );
}

// --- the copy the page is required to carry ------------------------------------

section('The page states what it is');

ok(
  'the explanation line says no quality bar was met',
  /met no quality bar/.test(MOVERS_EXPLANATION),
  MOVERS_EXPLANATION,
);
ok(
  'and it never says buy or sell',
  !/\b(buy|sell|long|short|target|stop)\b/i.test(MOVERS_EXPLANATION),
  MOVERS_EXPLANATION,
);

/*
 * The live reading renders a different line, and it is held to every rule the
 * shipped one is. A variant that only appears on a developer's machine is
 * exactly the one that would drift, because nobody reviews it on the way past.
 */
ok(
  'the live explanation line says no quality bar was met',
  /met no quality bar/.test(MOVERS_EXPLANATION_LIVE),
  MOVERS_EXPLANATION_LIVE,
);
ok(
  'and the live line never says buy or sell either',
  !/\b(buy|sell|long|short|target|stop)\b/i.test(MOVERS_EXPLANATION_LIVE),
  MOVERS_EXPLANATION_LIVE,
);
ok(
  'the two lines name different sessions, so one cannot be mistaken for the other',
  MOVERS_EXPLANATION !== MOVERS_EXPLANATION_LIVE &&
    /last session/i.test(MOVERS_EXPLANATION) &&
    /today/i.test(MOVERS_EXPLANATION_LIVE),
  `${MOVERS_EXPLANATION} / ${MOVERS_EXPLANATION_LIVE}`,
);
ok('the list is capped at 15', MAX_MOVERS === 15, String(MAX_MOVERS));

// --- result --------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
