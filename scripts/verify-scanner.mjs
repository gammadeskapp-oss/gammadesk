/*
 * Validation of the scanner's rules, its scoring, its funnel, and the
 * option-quality badge.
 *
 * Why this file exists: this page outputs a ranked list of stock tickers,
 * which is the most actionable thing the whole site produces. The properties
 * checked here are the ones that would cost someone money if they broke:
 *
 *  1. `unknown` never becomes `pass`, and never becomes a zero in the score.
 *     A rule nobody could evaluate must not push a name down the list, and
 *     must not let it up.
 *  2. An unknown earnings date is never treated as "no earnings soon". This is
 *     the one that would actually cost money — a name reporting tomorrow, near
 *     the top of a ranked list, with nothing said about it.
 *  3. No badge above `caution` is ever issued over incomplete data.
 *  4. The funnel adds up. It is the only thing on the page that can explain a
 *     morning where nothing passes, so counts that did not decrease
 *     monotonically, or did not match the list underneath them, would be
 *     worse than no funnel.
 *  5. A link reproduces a list. Settings survive the round trip through the
 *     query string exactly, or a shared configuration is a lie.
 *
 * Run: npm run verify:scanner
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { gradeContract, pickContract, contractSummary } = await import(
  '../src/lib/scanner/optionQuality.ts'
);
const { buildWatchLine, whyItRanks, readExtension } = await import(
  '../src/lib/scanner/evaluate.ts'
);
const {
  DEFAULT_FILTERS,
  FILTER_BOUNDS,
  SCORE_WEIGHTS,
  buildFunnel,
  clampSettings,
  excludedByEarnings,

  scoreAndJudge,
  scoreRow,
} = await import('../src/lib/scanner/score.ts');
const { paramsFromSettings, settingsFromParams, isDefault } = await import(
  '../src/lib/scanner/filterState.ts'
);
const { excludedForEarnings, daysBetween } = await import(
  '../src/lib/scanner/earningsRules.ts'
);
const {
  RULE_KEYS,
  EARNINGS_EXCLUSION_DAYS,
  EXTENDED_PCT,
  OPTION_WINDOW,
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

/** A name that clears every rule at the shipped defaults. */
function row(overrides = {}) {
  const { metrics, ...rest } = overrides;
  return {
    symbol: 'TEST',
    price: 100,
    priceAsOf: '2026-08-31',
    metrics: {
      rsScore: 94,
      rsRank: 12,
      pctAbove200: 12,
      ema200: 89,
      pctAbove20: 1,
      ema20: 99,
      volumeRatio: 1.8,
      avgDollarVolume: 900_000_000,
      ...metrics,
    },
    equityTier: 'HIGH',
    optionsTier: 'HIGH',
    regime: 'positive',
    netGex: 1e9,
    magnets: [],
    earnings: { state: 'known', dateIso: '2026-10-15', daysAway: 45, source: 'test' },
    extension: { pctAbove20Ema: 1, ema20: 99, extended: false },
    optionQuality: null,
    ...rest,
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

function quality(overrides = {}) {
  return {
    badge: 'tradable',
    contract: contract(),
    reasons: ['Moderate bid/ask spread, 3.2% of mid.'],
    source: 'scan',
    checkedAt: '',
    quoteDateIso: null,
    ...overrides,
  };
}

/** A row that passes all five, contract included. */
const passing = (overrides = {}) =>
  row({ optionQuality: quality(), ...overrides });

const D = DEFAULT_FILTERS;
const clean = { earningsDaysAway: 45, earningsUnknown: false };
const judgeOne = (r, settings = D) => scoreAndJudge([r], settings)[0];

// --- 1. five rules -----------------------------------------------------------

section('Five rules, scored rather than ANDed');

ok('there are exactly five', RULE_KEYS.length === 5, RULE_KEYS.join(','));
ok('the contract is one of them', RULE_KEYS.includes('contract'));
for (const gone of ['vwap', 'gamma', 'nw', 'spyGamma']) {
  ok(`${gone} is not a rule`, !RULE_KEYS.includes(gone), 'the market regime is a banner now');
}

ok('all five passing passes', judgeOne(passing()).passes);

const failers = {
  rs: { rsScore: D.rsMin - 10 },
  ema: { pctAbove200: -5 },
  volume: { volumeRatio: 0.4 },
  liquidity: { avgDollarVolume: 20_000_000 },
};

for (const [key, metrics] of Object.entries(failers)) {
  const judged = judgeOne(passing({ metrics }));
  ok(`a failed ${key} is marked failed`, judged.verdicts[key].state === 'fail');
  ok(`a failed ${key} stops it passing`, !judged.passes);
  ok(
    `a failed ${key} still appears in the list`,
    scoreAndJudge([passing({ metrics })], D).length === 1,
    'a failing name is dimmed, never removed — that is the whole rebuild',
  );
  ok(
    `the failure names the number`,
    /\d/.test(judged.verdicts[key].detail),
    judged.verdicts[key].detail,
  );
}

ok(
  'a failing contract is marked failed',
  judgeOne(passing({ optionQuality: quality({ badge: 'avoid' }) })).verdicts.contract.state ===
    'fail',
);

section('Unknown is never folded into pass, and never into fail');

const unknowns = {
  rs: { rsScore: Number.NaN },
  ema: { pctAbove200: null },
  volume: { volumeRatio: null },
  liquidity: { avgDollarVolume: 0 },
};

for (const [key, metrics] of Object.entries(unknowns)) {
  const judged = judgeOne(passing({ metrics }));
  ok(`an unmeasurable ${key} is unknown`, judged.verdicts[key].state === 'unknown');
  ok(`and it does not pass`, !judged.passes, 'unknown must never be folded into pass');
  ok(
    `and it says why`,
    judged.verdicts[key].detail.length > 10,
    judged.verdicts[key].detail,
  );
}

ok(
  'an unchecked contract is unknown, not failed',
  judgeOne(row()).verdicts.contract.state === 'unknown',
  'nobody pulled the chain; that is not a fact about the stock',
);
ok(
  'and it says so in plain words',
  /not checked/i.test(judgeOne(row()).verdicts.contract.detail),
  judgeOne(row()).verdicts.contract.detail,
);
ok(
  'an ungradeable contract is unknown too',
  judgeOne(row({ optionQuality: quality({ badge: 'unknown', contract: null }) })).verdicts
    .contract.state === 'unknown',
);

section('Switching a rule off stops it counting but keeps its reading');

const offSettings = { ...D, enabled: { ...D.enabled, volume: false } };
const weak = passing({ metrics: { volumeRatio: 0.4 } });

ok('with the rule on it does not pass', !judgeOne(weak).passes);
ok('with the rule off it does', judgeOne(weak, offSettings).passes);
ok(
  'and the reading is still there, still failing',
  judgeOne(weak, offSettings).verdicts.volume.state === 'fail',
  'switching a rule off must not delete the number it was measuring',
);
ok(
  'the disabled rule is not listed as failing',
  !judgeOne(weak, offSettings).failing.includes('volume'),
);

// --- 2. scoring --------------------------------------------------------------

section('The score: a missing reading is dropped, never scored zero');

ok(
  'a full row scores every component',
  scoreRow(passing()).missing.length === 0,
  JSON.stringify(scoreRow(passing()).missing),
);
ok(
  'an unchecked contract drops the contract component',
  scoreRow(row()).missing.join(',') === 'contract',
  JSON.stringify(scoreRow(row()).missing),
);

const unchecked = scoreRow(row()).total;
const avoided = scoreRow(row({ optionQuality: quality({ badge: 'avoid' }) })).total;
ok(
  'an unchecked contract outranks one graded Avoid',
  unchecked > avoided,
  `unchecked ${unchecked.toFixed(2)} vs avoid ${avoided.toFixed(2)}`,
);
ok(
  'and an Excellent one outranks the unchecked',
  scoreRow(row({ optionQuality: quality({ badge: 'excellent' }) })).total > unchecked,
);

ok(
  'a name with no readings at all scores zero rather than throwing',
  scoreRow(
    row({
      metrics: {
        rsScore: Number.NaN,
        pctAbove200: null,
        volumeRatio: null,
        avgDollarVolume: 0,
      },
    }),
  ).total === 0,
);

ok('every score is inside 0-100', (() => {
  const extremes = [
    passing(),
    row({ metrics: { rsScore: 0, pctAbove200: -80, volumeRatio: 0.01, avgDollarVolume: 1 } }),
    row({ metrics: { rsScore: 100, pctAbove200: 500, volumeRatio: 40, avgDollarVolume: 9e11 } }),
  ];
  return extremes.every((r) => {
    const t = scoreRow(r).total;
    return Number.isFinite(t) && t >= 0 && t <= 100;
  });
})());

ok(
  'the weights are one object and cover exactly the five components',
  Object.keys(SCORE_WEIGHTS).sort().join(',') ===
    ['contract', 'liquidity', 'rs', 'trend', 'volume'].sort().join(','),
  Object.keys(SCORE_WEIGHTS).join(','),
);

section('The list is ordered by score, and the order is total');

const ordered = scoreAndJudge(
  [
    row({ symbol: 'LOW', metrics: { rsScore: 62, pctAbove200: 1, volumeRatio: 1 } }),
    row({ symbol: 'HIGH', metrics: { rsScore: 99, pctAbove200: 30, volumeRatio: 2.4 } }),
    row({ symbol: 'MID', metrics: { rsScore: 84, pctAbove200: 10, volumeRatio: 1.4 } }),
  ],
  D,
);
ok(
  'strongest first',
  ordered.map((e) => e.row.symbol).join(',') === 'HIGH,MID,LOW',
  ordered.map((e) => e.row.symbol).join(','),
);
ok(
  'nothing is dropped for failing',
  ordered.length === 3,
  'the whole point: a failing name is ranked and dimmed, not deleted',
);
ok(
  'ties break on symbol, so the order never reshuffles under the reader',
  (() => {
    const a = scoreAndJudge([row({ symbol: 'ZZZ' }), row({ symbol: 'AAA' })], D);
    const b = scoreAndJudge([row({ symbol: 'AAA' }), row({ symbol: 'ZZZ' })], D);
    return (
      a.map((e) => e.row.symbol).join(',') === 'AAA,ZZZ' &&
      b.map((e) => e.row.symbol).join(',') === 'AAA,ZZZ'
    );
  })(),
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
  ['clean row', passing()],
  ['unknown earnings', row({ earnings: unknownEarnings, optionQuality: quality() })],
  ['extended', passing({ extension: { pctAbove20Ema: 6, ema20: 94, extended: true } })],
  ['ungraded contract', row()],
  ['negative own gamma', passing({ regime: 'negative' })],
];

for (const [label, r] of cases) {
  const line = buildWatchLine(r, EARNINGS_EXCLUSION_DAYS);
  ok(`${label} produces text`, line.text.length > 0, line.text);
  ok(`${label} ends in something readable`, /\w/.test(line.text));
}

ok(
  'a row with nothing to flag still says something',
  buildWatchLine(passing(), EARNINGS_EXCLUSION_DAYS).text.length > 0,
);

ok(
  'the extended flag names the number',
  /6% above the 20-day average/.test(
    buildWatchLine(
      row({ extension: { pctAbove20Ema: 6, ema20: 94, extended: true } }),
      EARNINGS_EXCLUSION_DAYS,
    ).text,
  ),
);

ok(
  'an unchecked contract is called unknown on the watch line, not cleared',
  /unknown, not cleared/i.test(buildWatchLine(row(), EARNINGS_EXCLUSION_DAYS).text),
  buildWatchLine(row(), EARNINGS_EXCLUSION_DAYS).text,
);

ok(
  'the watch line follows the reader buffer',
  /inside your 30-day buffer/.test(
    buildWatchLine(
      row({ earnings: { state: 'known', dateIso: '2026-09-20', daysAway: 20, source: 'x' } }),
      30,
    ).text,
  ),
);

section('The row account always ends on Watch');

for (const [label, r] of cases) {
  const lines = whyItRanks(judgeOne(r), D);
  ok(`${label} has a Watch line last`, lines[lines.length - 1].label === 'Watch');
  ok(`${label} names the trend`, lines.some((l) => l.label === 'Trend'));
  ok(`${label} names the options`, lines.some((l) => l.label === 'Options'));
  ok(
    `${label} gives every line text`,
    lines.every((l) => l.text.length > 5),
    JSON.stringify(lines.map((l) => l.text)),
  );
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

// --- 8. the funnel adds up ---------------------------------------------------

section('The funnel is cumulative, monotonic, and matches the list');

const population = [
  passing({ symbol: 'ALL' }),
  passing({ symbol: 'WEAKRS', metrics: { rsScore: 60 } }),
  passing({ symbol: 'UNDER200', metrics: { pctAbove200: -8 } }),
  passing({ symbol: 'NOVOL', metrics: { volumeRatio: 0.5 } }),
  passing({ symbol: 'THIN', metrics: { avgDollarVolume: 15_000_000 } }),
  row({ symbol: 'UNGRADED' }),
  passing({
    symbol: 'REPORTS',
    earnings: { state: 'known', dateIso: '2026-09-04', daysAway: 3, source: 'x' },
  }),
];

const judgedPop = scoreAndJudge(population, D);
const funnel = buildFunnel(judgedPop, D);

ok('the first stage is everything scanned', funnel[0].count === population.length);
ok(
  'there is a stage per enabled rule plus earnings',
  funnel.length === RULE_KEYS.length + 2,
  String(funnel.length),
);
ok(
  'counts never increase',
  funnel.every((stage, i) => i === 0 || stage.count <= funnel[i - 1].count),
  funnel.map((s) => s.count).join(' → '),
);
ok(
  'every stage lists exactly as many symbols as it counts',
  funnel.every((stage) => stage.symbols.length === stage.count),
);
ok(
  'each stage is a subset of the one before it',
  funnel.every(
    (stage, i) =>
      i === 0 || stage.symbols.every((s) => funnel[i - 1].symbols.includes(s)),
  ),
  'a name cannot re-enter a funnel it fell out of',
);
ok(
  'the last stage matches the names that actually pass',
  funnel[funnel.length - 1].count ===
    judgedPop.filter((e) => e.passes && !e.earningsExcluded).length,
  `${funnel[funnel.length - 1].count} vs ${judgedPop.filter((e) => e.passes && !e.earningsExcluded).length}`,
);
ok(
  'and it is the one name that clears everything',
  funnel[funnel.length - 1].symbols.join(',') === 'ALL',
  funnel[funnel.length - 1].symbols.join(','),
);
ok(
  'the ungraded name falls out at the contract stage, not before',
  funnel.find((s) => s.key === 'contract').symbols.includes('UNGRADED') === false &&
    funnel.find((s) => s.key === 'liquidity').symbols.includes('UNGRADED') === true,
  'an unchecked contract is unknown, which is not a pass — but it clears everything upstream',
);
ok(
  'the earnings stage removes the name reporting on Friday',
  funnel.find((s) => s.key === 'earnings').symbols.includes('REPORTS') === false,
);
ok(
  'every stage is labelled in words a reader can check',
  funnel.every((s) => typeof s.label === 'string' && s.label.length > 2),
  JSON.stringify(funnel.map((s) => s.label)),
);

ok(
  'a disabled rule is not a stage',
  buildFunnel(judgedPop, offSettings).some((s) => s.key === 'volume') === false,
  'a step nothing fell out of is not a step',
);

section('The earnings buffer is the readers, and unknown never clears');

ok(
  'a report 20 days out is clear at the default buffer',
  !excludedByEarnings(
    row({ earnings: { state: 'known', dateIso: 'x', daysAway: 20, source: 'x' } }),
    D.earningsBufferDays,
  ),
);
ok(
  'and excluded at a 30-day buffer',
  excludedByEarnings(
    row({ earnings: { state: 'known', dateIso: 'x', daysAway: 20, source: 'x' } }),
    30,
  ),
);
ok(
  'an unknown date is never excluded at any buffer',
  [0, 10, 60].every(
    (buffer) => !excludedByEarnings(row({ earnings: unknownEarnings }), buffer),
  ),
  'unknown is not far-away and it is not near — nobody looked',
);

// --- 9. settings survive the URL --------------------------------------------

section('A link reproduces a list exactly');

ok('the defaults serialise to nothing', paramsFromSettings(D) === '', paramsFromSettings(D));
ok('and are recognised as default', isDefault(D));
ok(
  'an empty query string restores the defaults',
  JSON.stringify(settingsFromParams(new URLSearchParams(''))) === JSON.stringify(D),
);

const custom = {
  ...D,
  rsMin: 71,
  volumeMult: 1.65,
  minDollarVolume: 40_000_000,
  trendPct: -6,
  dteMin: 14,
  dteMax: 90,
  deltaMin: 0.3,
  deltaMax: 0.85,
  earningsBufferDays: 21,
  enabled: { ...D.enabled, liquidity: false, contract: false },
  requireCalmMarket: true,
};

const roundTripped = settingsFromParams(new URLSearchParams(paramsFromSettings(custom)));
ok(
  'every control survives the round trip',
  JSON.stringify(roundTripped) === JSON.stringify(custom),
  `${JSON.stringify(roundTripped)} vs ${JSON.stringify(custom)}`,
);
ok('a changed configuration is not reported as default', !isDefault(custom));
ok(
  'only what differs is written',
  (() => {
    const query = paramsFromSettings({ ...D, rsMin: 75 });
    return query === 'rs=75';
  })(),
  paramsFromSettings({ ...D, rsMin: 75 }),
);

section('A hand-edited link degrades rather than breaking');

ok(
  'nonsense falls back to the default',
  settingsFromParams(new URLSearchParams('rs=banana')).rsMin === D.rsMin,
);
ok(
  'an out-of-range value is clamped, not honoured',
  settingsFromParams(new URLSearchParams('rs=9999')).rsMin === FILTER_BOUNDS.rsMin.max,
);
ok(
  'a crossed range is clamped rather than swapped',
  (() => {
    const crossed = clampSettings({ ...D, dteMin: 90, dteMax: 20 });
    return crossed.dteMax >= crossed.dteMin;
  })(),
);
ok(
  'an unknown rule name in the off-list is ignored',
  settingsFromParams(new URLSearchParams('off=nonsense')).enabled.rs === true,
);
ok(
  'every clamped setting stays inside its slider bounds',
  (() => {
    const wild = clampSettings({
      ...D,
      rsMin: -50,
      volumeMult: 900,
      minDollarVolume: -1,
      trendPct: 9999,
      earningsBufferDays: -4,
      deltaMin: -1,
      deltaMax: 40,
    });
    const b = FILTER_BOUNDS;
    return (
      wild.rsMin >= b.rsMin.min &&
      wild.volumeMult <= b.volumeMult.max &&
      wild.minDollarVolume >= b.minDollarVolume.min &&
      wild.trendPct <= b.trendPct.max &&
      wild.earningsBufferDays >= b.earningsBufferDays.min &&
      wild.deltaMin >= b.delta.min &&
      wild.deltaMax <= b.delta.max
    );
  })(),
);

// --- 10. the list is never empty --------------------------------------------

section('The page always has rows, however many pass');

ok(
  'a population where nothing passes still ranks every name',
  (() => {
    const nobody = scoreAndJudge(
      [
        passing({ symbol: 'A', metrics: { rsScore: 20 } }),
        passing({ symbol: 'B', metrics: { rsScore: 30 } }),
        passing({ symbol: 'C', metrics: { rsScore: 40 } }),
      ],
      D,
    );
    return (
      nobody.length === 3 &&
      nobody.every((e) => !e.passes) &&
      nobody.map((e) => e.row.symbol).join(',') === 'C,B,A'
    );
  })(),
  'this is the failure the whole rebuild exists to fix',
);

ok(
  'and every one of them says what stopped it',
  scoreAndJudge([passing({ metrics: { rsScore: 20 } })], D).every(
    (e) => e.failingLabel.length > 15,
  ),
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
