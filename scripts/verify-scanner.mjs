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
const {
  evaluateRow,
  partition,
  buildWatchLine,
  whyItMatched,
  readExtension,
  alignmentBadges,
} = await import('../src/lib/scanner/evaluate.ts');
const { SCANNER_PRESETS, applyPreset, presetById, PULLBACK_BAND_PCT } =
  await import('../src/lib/scanner/presets.ts');
const { excludedForEarnings, daysBetween } = await import(
  '../src/lib/scanner/earningsRules.ts'
);
const {
  FILTER_KEYS,
  EARNINGS_EXCLUSION_DAYS,
  EXTENDED_PCT,
  OPTION_WINDOW,
  ALIGNMENT_KEYS,
} = await import('../src/lib/scanner/types.ts');

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


// --- 8. alignment badges -----------------------------------------------------

section('Alignment badges: four, always, never weighted toward green');

const goodQuality = {
  badge: 'tradable',
  contract: contract(),
  reasons: ['Moderate bid/ask spread, 3.2% of mid.'],
  source: 'scan',
  checkedAt: '',
  quoteDateIso: null,
};

ok('there are exactly four', ALIGNMENT_KEYS.length === 4, ALIGNMENT_KEYS.join(','));

for (const [label, r] of [
  ['clean', row({ optionQuality: goodQuality })],
  ['ungraded contract', row()],
  ['unknown earnings', row({ earnings: unknownEarnings })],
  [
    'failed trend gate',
    row({
      single: gates({
        // The wording run.ts actually emits. A terse fixture here would let
        // the badge pass this check while printing something unreadable.
        ema: { state: 'fail', detail: 'below the 200-day average' },
      }),
    }),
  ],
  ['unreadable extension', row({ extension: { pctAbove20Ema: null, ema20: null, extended: false } })],
]) {
  const badges = alignmentBadges(r);
  ok(`${label} renders all four`, badges.length === 4, String(badges.length));
  ok(
    `${label} keeps the declared order`,
    badges.map((b) => b.key).join(',') === ALIGNMENT_KEYS.join(','),
    badges.map((b) => b.key).join(','),
  );
  ok(
    `${label} gives every badge evidence`,
    badges.every((b) => typeof b.detail === 'string' && b.detail.length > 5),
    JSON.stringify(badges.map((b) => b.detail)),
  );
}

const byKey = (r) => Object.fromEntries(alignmentBadges(r).map((b) => [b.key, b]));

ok(
  'an ungraded contract is never a green options badge',
  byKey(row()).options.state === 'unknown',
);
ok(
  'an Avoid contract is a red options badge',
  byKey(row({ optionQuality: { ...goodQuality, badge: 'avoid' } })).options.state === 'fail',
);
ok(
  'a Caution contract is also red, not green',
  byKey(row({ optionQuality: { ...goodQuality, badge: 'caution' } })).options.state === 'fail',
  'this badge answers a yes/no question and caution is a no',
);
ok(
  'an ungradeable contract is unknown, not red',
  byKey(row({ optionQuality: { ...goodQuality, badge: 'unknown' } })).options.state === 'unknown',
);

ok(
  'trend is green only when both averages agree',
  byKey(row({ extension: { pctAbove20Ema: 3, ema20: 97, extended: false } })).trend.state ===
    'pass',
);
ok(
  'above the 200-day but under the 20-day is red',
  byKey(row({ extension: { pctAbove20Ema: -4, ema20: 104, extended: false } })).trend.state ===
    'fail',
  'the two trends disagree and the badge has to show it',
);
ok(
  'and it says which way',
  /below its 20-day/.test(
    byKey(row({ extension: { pctAbove20Ema: -4, ema20: 104, extended: false } })).trend.detail,
  ),
);
ok(
  'an unreadable 20-day is unknown, not green',
  byKey(row({ extension: { pctAbove20Ema: null, ema20: null, extended: false } })).trend.state ===
    'unknown',
);

ok(
  'momentum names the extension without turning red for it',
  (() => {
    const b = byKey(row({ extension: { pctAbove20Ema: 8, ema20: 92, extended: true } })).momentum;
    return b.state === 'pass' && /8% above its 20-day average/.test(b.detail);
  })(),
);

// --- 9. presets never widen the list ----------------------------------------

section('Presets are a view, never a second rule set');

ok('there are three views', SCANNER_PRESETS.length === 3);
ok('no put preset exists in this branch', !SCANNER_PRESETS.some((p) => /put|bear|short/i.test(p.label)));
ok('an unknown id falls back to All results', presetById('nonsense').id === 'all');

const survivors = [
  row({ symbol: 'RUN', extension: { pctAbove20Ema: 7, ema20: 93, extended: true } }),
  row({ symbol: 'EASED', extension: { pctAbove20Ema: 0.5, ema20: 99, extended: false } }),
  row({ symbol: 'UNDER', extension: { pctAbove20Ema: -3, ema20: 103, extended: false } }),
  row({ symbol: 'BLIND', extension: { pctAbove20Ema: null, ema20: null, extended: false } }),
];

const all = applyPreset(presetById('all'), survivors);
const cont = applyPreset(presetById('continuation'), survivors);
const pull = applyPreset(presetById('pullback'), survivors);

ok('All results shows everything', all.length === survivors.length);
ok(
  'continuation takes the extended one',
  cont.map((e) => e.row.symbol).join(',') === 'RUN',
  cont.map((e) => e.row.symbol).join(','),
);
ok(
  'pullback takes the two near or under the average',
  pull.map((e) => e.row.symbol).join(',') === 'EASED,UNDER',
  pull.map((e) => e.row.symbol).join(','),
);
ok(
  'a name with no 20-day reading is in neither',
  !cont.some((e) => e.row.symbol === 'BLIND') && !pull.some((e) => e.row.symbol === 'BLIND'),
  'a preset that admitted unmeasured names would be selecting on nothing',
);

for (const [label, list] of [['continuation', cont], ['pullback', pull]]) {
  ok(
    `${label} states why it selected each name`,
    list.every((e) => e.reason.length > 15),
    JSON.stringify(list.map((e) => e.reason)),
  );
}

ok(
  'the two shapes never overlap',
  cont.filter((c) => pull.some((p) => p.row.symbol === c.row.symbol)).length === 0,
  'one boundary, so a ticker cannot appear under two contradictory descriptions',
);
ok(
  'and together they cover every measurable survivor',
  cont.length + pull.length === survivors.filter((r) => r.extension.pctAbove20Ema !== null).length,
);

ok(
  'no preset can admit a name that failed a gate',
  (() => {
    const failed = row({
      symbol: 'NOPE',
      single: gates({ ema: { state: 'fail', detail: 'below the 200-day average' } }),
      extension: { pctAbove20Ema: 7, ema20: 93, extended: true },
    });
    // partition is what feeds applyPreset; a failing row never reaches it.
    return partition([failed]).passed.length === 0;
  })(),
);

ok(
  'the pullback band matches the constant',
  applyPreset(presetById('pullback'), [
    row({ extension: { pctAbove20Ema: PULLBACK_BAND_PCT, ema20: 98, extended: false } }),
  ]).length === 1,
);
ok(
  'and just past it is continuation',
  applyPreset(presetById('continuation'), [
    row({ extension: { pctAbove20Ema: PULLBACK_BAND_PCT + 0.1, ema20: 98, extended: false } }),
  ]).length === 1,
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
