/*
 * Validation of the scanner's gates, its earnings rule, and the option-quality
 * badge.
 *
 * Why this file exists: this page outputs a shortlist of stock tickers, which
 * is the most actionable thing the whole site produces. Three of its rules are
 * therefore checked here rather than trusted:
 *
 *  1. `unknown` never becomes `pass`. A gate nobody could compute must keep a
 *     name off the list exactly as a failure does.
 *  2. An unknown earnings date is never treated as "no earnings soon". This is
 *     the one that would actually cost someone money — a name reporting
 *     tomorrow, on a shortlist, with nothing said about it.
 *  3. No badge above `caution` is ever issued over incomplete data.
 *
 * Run: npm run verify:scanner
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { gradeContract, pickContract, contractSummary } = await import(
  '../src/lib/scanner/optionQuality.ts'
);
const { evaluateRow, partition, buildWatchLine, whyItMatched, readExtension } =
  await import('../src/lib/scanner/evaluate.ts');
const { excludedForEarnings, daysBetween } = await import(
  '../src/lib/scanner/earningsRules.ts'
);
const { FILTER_KEYS, EARNINGS_EXCLUSION_DAYS, EXTENDED_PCT, OPTION_WINDOW } =
  await import('../src/lib/scanner/types.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(name) {
  console.log(`\n${name}`);
}

// --- fixtures ----------------------------------------------------------------

const pass = (detail) => ({ state: 'pass', detail });

function gates(overrides = {}) {
  const out = {};
  for (const key of FILTER_KEYS) out[key] = pass(`${key} ok`);
  return { ...out, ...overrides };
}

function row(overrides = {}) {
  return {
    symbol: 'TEST',
    price: 100,
    priceAsOf: '2026-08-31',
    rsScore: 94,
    rsRank: 12,
    equityTier: 'HIGH',
    optionsTier: 'HIGH',
    regime: 'positive',
    netGex: 1e9,
    magnets: [],
    single: gates(),
    timeframes: [],
    earnings: { state: 'known', dateIso: '2026-10-15', daysAway: 45, source: 'test' },
    extension: { pctAbove20Ema: 1, ema20: 99, extended: false },
    optionQuality: null,
    ...overrides,
  };
}

function contract(overrides = {}) {
  return {
    expiration: '2026-10-16',
    strike: 105,
    dte: 45,
    delta: 0.62,
    openInterest: 2400,
    volume: 300,
    bid: 4.9,
    ask: 5.1,
    mid: 5,
    spreadPctOfMid: 4,
    ivPct: 32,
    ...overrides,
  };
}

const clean = { earningsDaysAway: 45, earningsUnknown: false };

// --- 1. five gates, all hard -------------------------------------------------

section('Five gates, all hard');

ok('there are exactly five', FILTER_KEYS.length === 5, FILTER_KEYS.join(','));
for (const gone of ['vwap', 'gamma', 'nw']) {
  ok(`${gone} is not a gate`, !FILTER_KEYS.includes(gone));
}

ok('all five passing passes', evaluateRow(row()).passes);

for (const key of FILTER_KEYS) {
  ok(
    `a failed ${key} blocks the name`,
    !evaluateRow(row({ single: gates({ [key]: { state: 'fail', detail: 'x' } }) })).passes,
  );
  ok(
    `an UNKNOWN ${key} also blocks the name`,
    !evaluateRow(row({ single: gates({ [key]: { state: 'unknown', detail: 'x' } }) })).passes,
    'unknown must never be folded into pass',
  );
}

// --- 2. ranking and partitioning --------------------------------------------

section('The list ranks on relative strength');

const ranked = partition([
  row({ symbol: 'LOW', rsScore: 91 }),
  row({ symbol: 'HIGH', rsScore: 98 }),
  row({ symbol: 'MID', rsScore: 94 }),
]);

ok('all three pass', ranked.passed.length === 3);
ok(
  'strongest first',
  ranked.passed.map((e) => e.row.symbol).join(',') === 'HIGH,MID,LOW',
  ranked.passed.map((e) => e.row.symbol).join(','),
);

const blocked = partition([
  row({ symbol: 'A', single: gates({ spyGamma: { state: 'fail', detail: 'x' } }) }),
  row({ symbol: 'B', single: gates({ spyGamma: { state: 'fail', detail: 'x' } }) }),
  row({ symbol: 'C', single: gates({ volume: { state: 'fail', detail: 'x' } }) }),
]);
ok('nothing passes', blocked.passed.length === 0);
ok('every candidate is still listed', blocked.all.length === 3);
ok(
  'the biggest eliminator is named',
  blocked.biggestEliminator?.key === 'spyGamma' && blocked.biggestEliminator.count === 2,
  JSON.stringify(blocked.biggestEliminator),
);

// --- 3. earnings: unknown is never "no earnings soon" ------------------------

section('An unknown earnings date is never treated as clear');

const unknownEarnings = { state: 'unknown', dateIso: null, daysAway: null, source: 'x' };

ok('unknown does not exclude', !excludedForEarnings(unknownEarnings));
ok(
  'and it is never silently cleared — the watch line says so',
  /earnings date unknown/i.test(buildWatchLine(row({ earnings: unknownEarnings })).text),
  buildWatchLine(row({ earnings: unknownEarnings })).text,
);

ok(
  'a report inside the window excludes',
  excludedForEarnings({ state: 'known', dateIso: '2026-09-05', daysAway: 5, source: 'x' }),
);
ok(
  `${EARNINGS_EXCLUSION_DAYS} days away still excludes`,
  excludedForEarnings({
    state: 'known',
    dateIso: 'x',
    daysAway: EARNINGS_EXCLUSION_DAYS,
    source: 'x',
  }),
);
ok(
  `${EARNINGS_EXCLUSION_DAYS + 1} days away does not`,
  !excludedForEarnings({
    state: 'known',
    dateIso: 'x',
    daysAway: EARNINGS_EXCLUSION_DAYS + 1,
    source: 'x',
  }),
);
ok(
  'a past report does not exclude',
  !excludedForEarnings({ state: 'known', dateIso: 'x', daysAway: -3, source: 'x' }),
);

ok('daysBetween counts calendar days', daysBetween('2026-08-31', '2026-09-10') === 10);
ok('and is zero on the same day', daysBetween('2026-08-31', '2026-08-31') === 0);
ok(
  'and does not drift across a DST boundary',
  daysBetween('2026-10-30', '2026-11-06') === 7,
);

// --- 4. the watch line is never empty ---------------------------------------

section('Every result carries a watch line');

const cases = [
  ['clean row', row({ optionQuality: { badge: 'excellent', contract: contract(), reasons: ['x'], source: 'scan', checkedAt: '', quoteDateIso: null } })],
  ['unknown earnings', row({ earnings: unknownEarnings })],
  ['extended', row({ extension: { pctAbove20Ema: 6, ema20: 94, extended: true } })],
  ['ungraded contract', row()],
  ['negative own gamma', row({ regime: 'negative' })],
];

for (const [label, r] of cases) {
  const line = buildWatchLine(r);
  ok(`${label} produces text`, line.text.length > 0, line.text);
  ok(`${label} ends in something readable`, /\w/.test(line.text));
}

ok(
  'a row with nothing to flag still says something',
  buildWatchLine(
    row({
      optionQuality: {
        badge: 'excellent',
        contract: contract(),
        reasons: ['x'],
        source: 'scan',
        checkedAt: '',
        quoteDateIso: null,
      },
    }),
  ).text.length > 0,
);

ok(
  'the extended flag names the number',
  /6% above the 20-day average/.test(
    buildWatchLine(row({ extension: { pctAbove20Ema: 6, ema20: 94, extended: true } })).text,
  ),
);

section('Why-it-matched always ends on Watch');

for (const [label, r] of cases) {
  const lines = whyItMatched(r);
  ok(`${label} has a Watch line`, lines[lines.length - 1].label === 'Watch');
  ok(`${label} names the trend`, lines.some((l) => l.label === 'Trend'));
  ok(`${label} names the options`, lines.some((l) => l.label === 'Options'));
}

// --- 5. extension is a flag, not a rejection --------------------------------

section('Extension');

ok('unreadable is not extended', readExtension(null, null).extended === false);
ok('a missing average is not extended', readExtension(100, null).extended === false);
ok(
  `${EXTENDED_PCT}% is not yet extended`,
  readExtension(105, 100).extended === false,
  'the threshold is exclusive',
);
ok('past it is', readExtension(106, 100).extended === true);
ok('below the average is not', readExtension(90, 100).extended === false);

// --- 6. the option badge -----------------------------------------------------

section('Option quality: no green badge over incomplete data');

ok(
  'a missing spread is unknown, not caution',
  gradeContract({ contract: contract({ spreadPctOfMid: null }), ...clean }).badge === 'unknown',
);
ok(
  'a missing open interest is unknown',
  gradeContract({ contract: contract({ openInterest: null }), ...clean }).badge === 'unknown',
);
ok(
  'no contract in the window is unknown',
  gradeContract({ contract: null, ...clean }).badge === 'unknown',
);
ok(
  'an unreadable chain is unknown',
  gradeContract({ contract: null, ...clean, unreadable: 'chain down' }).badge === 'unknown',
);

section('Option quality: the bands');

ok(
  'tight and deep is excellent',
  gradeContract({ contract: contract({ spreadPctOfMid: 1.5, openInterest: 4000 }), ...clean })
    .badge === 'excellent',
);
ok(
  'moderate is tradable',
  gradeContract({ contract: contract({ spreadPctOfMid: 3.2, openInterest: 2400 }), ...clean })
    .badge === 'tradable',
);
ok(
  'wide-ish is caution',
  gradeContract({ contract: contract({ spreadPctOfMid: 8, openInterest: 200 }), ...clean })
    .badge === 'caution',
);
ok(
  'very wide is avoid',
  gradeContract({ contract: contract({ spreadPctOfMid: 14, openInterest: 4000 }), ...clean })
    .badge === 'avoid',
);
ok(
  'illiquid is avoid whatever the spread',
  gradeContract({ contract: contract({ spreadPctOfMid: 1, openInterest: 10 }), ...clean })
    .badge === 'avoid',
);
ok(
  'elevated IV pulls it down to caution',
  gradeContract({ contract: contract({ spreadPctOfMid: 1.5, openInterest: 4000, ivPct: 120 }), ...clean })
    .badge === 'caution',
);

section('Option quality: earnings drive the badge too');

ok(
  'earnings inside 10 days is avoid',
  gradeContract({
    contract: contract({ spreadPctOfMid: 1, openInterest: 9000 }),
    earningsDaysAway: 4,
    earningsUnknown: false,
  }).badge === 'avoid',
);
ok(
  'an unknown earnings date caps the badge at caution',
  gradeContract({
    contract: contract({ spreadPctOfMid: 1, openInterest: 9000 }),
    earningsDaysAway: null,
    earningsUnknown: true,
  }).badge === 'caution',
  'excellent beside a name that might report on Tuesday is unsupported',
);

section('Every badge states its reasons');

const grades = [
  gradeContract({ contract: contract(), ...clean }),
  gradeContract({ contract: null, ...clean }),
  gradeContract({ contract: contract({ spreadPctOfMid: null }), ...clean }),
  gradeContract({ contract: contract({ openInterest: 5 }), ...clean }),
  gradeContract({ contract: contract(), earningsDaysAway: 2, earningsUnknown: false }),
];
for (const [i, grade] of grades.entries()) {
  ok(`grade ${i} has at least one reason`, grade.reasons.length > 0);
  ok(
    `grade ${i} reasons are sentences`,
    grade.reasons.every((r) => r.length > 15),
    JSON.stringify(grade.reasons),
  );
}

// --- 7. contract selection ---------------------------------------------------

section('Contract selection stays inside the stated window');

ok(
  'a delta below the band is not picked',
  pickContract([contract({ delta: 0.3 })]) === null,
);
ok(
  'a delta above the band is not picked',
  pickContract([contract({ delta: 0.9 })]) === null,
);
ok(
  'a DTE below the window is not picked',
  pickContract([contract({ dte: 10 })]) === null,
);
ok(
  'a DTE above the window is not picked',
  pickContract([contract({ dte: 120 })]) === null,
);
ok(
  'a null delta is never picked',
  pickContract([contract({ delta: null })]) === null,
  'an unmodellable delta must not enter the window by default',
);

const picked = pickContract([
  contract({ strike: 100, delta: 0.56 }),
  contract({ strike: 105, delta: 0.63 }),
  contract({ strike: 110, delta: 0.69 }),
]);
ok(
  'the middle of the delta band wins, not the edge',
  picked?.strike === 105,
  `picked ${picked?.strike}`,
);
ok(
  'the window matches the spec',
  OPTION_WINDOW.minDte === 30 &&
    OPTION_WINDOW.maxDte === 60 &&
    OPTION_WINDOW.minDelta === 0.55 &&
    OPTION_WINDOW.maxDelta === 0.7,
);

section('The summary prints the four numbers');

const summary = contractSummary(contract());
for (const part of ['45 DTE', '0.62 delta', '2,400 OI', '4.0% spread']) {
  ok(`summary contains ${part}`, summary.includes(part), summary);
}
ok(
  'a missing number says unknown rather than zero',
  contractSummary(contract({ openInterest: null })).includes('OI unknown'),
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
