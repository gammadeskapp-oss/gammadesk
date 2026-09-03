/*
 * Validation of the scanner's rules, its scoring, its funnel, and the
 * option-quality badge.
 *
 * Why this file exists: this page outputs a ranked list of stock tickers,
 * which is the most actionable thing the whole site produces. The properties
 * checked here are the ones that would cost someone money if they broke:
 *
 *  1. `unknown` never becomes `pass`, and never becomes a zero in the score.
 *     A reading nobody could take must not push a name down the list, and must
 *     not let it up. Most of the index has no dealer-positioning reading on any
 *     given morning, so this one carries real weight.
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
const { buildWatchLine, whyItMatched, whyItRanks, readExtension } = await import(
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
  trendScore,
  SCORE_KEYS,
} = await import('../src/lib/scanner/score.ts');
const { paramsFromSettings, settingsFromParams, isDefault } = await import(
  '../src/lib/scanner/filterState.ts'
);
const { excludedForEarnings, daysBetween } = await import(
  '../src/lib/scanner/earningsRules.ts'
);
const {
  RULE_KEYS,
  SCANNER_TOP_N,
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

/**
 * Stable JSON, so a settings object can be compared by value.
 *
 * `JSON.stringify` preserves insertion order, and the URL round trip rebuilds
 * the object from scratch — so an identical configuration serialises to a
 * different string purely because the keys came back in a different order.
 * Comparing that would fail on a difference no reader could ever see.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

const sameSettings = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function section(name) {
  console.log(`\n${name}`);
}

// --- fixtures ----------------------------------------------------------------

/** A name that clears every filter, with every component measurable. */
function row(overrides = {}) {
  const { metrics, ...rest } = overrides;
  return {
    symbol: 'TEST',
    price: 100,
    priceAsOf: '2026-08-31',
    metrics: {
      rsScore: 94,
      rsRank: 12,
      m1Percentile: 88,
      pctAbove200: 12,
      ema200: 89,
      pctAbove50: 6,
      ema50: 94,
      pctAbove20: 1,
      ema20: 99,
      volumeRatio: 1.8,
      avgDollarVolume: 900_000_000,
      vwap20: 96,
      pctAboveVwap: 4,
      ...metrics,
    },
    equityTier: 'HIGH',
    optionsTier: 'HIGH',
    regime: 'positive',
    netGex: 1e9,
    magnets: [],
    optionsVolume: 40_000,
    optionsOpenInterest: 120_000,
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
/** Every filter switched on, for the checks that are about one filter. */
const ALL_ON = {
  ...D,
  enabled: Object.fromEntries(RULE_KEYS.map((key) => [key, true])),
};
const clean = { earningsDaysAway: 45, earningsUnknown: false };
/** A calm market, so the market component and filter have something to read. */
const MARKET = { spyRegime: 'positive' };
const judgeOne = (r, settings = ALL_ON, market = MARKET) =>
  scoreAndJudge([r], settings, market)[0];

// --- 1. the filters ----------------------------------------------------------

section('Eight filters, which narrow the list and never empty it');

ok('there are exactly eight', RULE_KEYS.length === 8, RULE_KEYS.join(','));
ok('the contract is one of them', RULE_KEYS.includes('contract'));
for (const added of ['trend', 'vwap', 'gamma', 'spy']) {
  ok(`${added} is a filter`, RULE_KEYS.includes(added));
}
ok(
  'the old distance-above-200 rule is gone, replaced by the trend score',
  !RULE_KEYS.includes('ema'),
);

section('The shipped defaults are RS and liquidity, and nothing else');

ok('relative strength is on', D.enabled.rs === true);
ok('the liquidity floor is on', D.enabled.liquidity === true);
ok('the RS cutoff is 80', D.rsMin === 80, String(D.rsMin));
ok(
  'every other filter ships off',
  RULE_KEYS.filter((key) => D.enabled[key]).sort().join(',') === 'liquidity,rs',
  RULE_KEYS.filter((key) => D.enabled[key]).join(','),
);

ok('a clean row matches every filter', judgeOne(passing()).passes);

const failers = {
  rs: { rsScore: D.rsMin - 10 },
  trend: { pctAbove200: -5, pctAbove50: -4, ema50: 80, ema200: 95, m1Percentile: 8 },
  volume: { volumeRatio: 0.4 },
  vwap: { pctAboveVwap: -3 },
  liquidity: { avgDollarVolume: 20_000_000 },
};

for (const [key, metrics] of Object.entries(failers)) {
  const judged = judgeOne(passing({ metrics }));
  ok(`a failed ${key} is marked failed`, judged.verdicts[key].state === 'fail');
  ok(`a failed ${key} stops it passing`, !judged.passes);
  ok(
    `a failed ${key} still appears in the list`,
    scoreAndJudge([passing({ metrics })], ALL_ON, MARKET).length === 1,
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
ok(
  'negative own gamma fails the gamma filter',
  judgeOne(passing({ regime: 'negative' })).verdicts.gamma.state === 'fail',
);
ok(
  'a volatile market fails the market filter, for every name identically',
  scoreAndJudge([passing(), passing({ symbol: 'B' })], ALL_ON, {
    spyRegime: 'negative',
  }).every((e) => e.verdicts.spy.state === 'fail'),
);

section('Unknown is never folded into pass, and never into fail');

const unknowns = {
  rs: { rsScore: Number.NaN },
  trend: {
    pctAbove200: null,
    ema200: null,
    pctAbove50: null,
    ema50: null,
    m1Percentile: null,
  },
  volume: { volumeRatio: null },
  vwap: { pctAboveVwap: null },
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
ok(
  'a name with no chain pulled has unknown gamma, not negative',
  judgeOne(passing({ regime: null })).verdicts.gamma.state === 'unknown',
  'most of the index is in this state every morning',
);
ok(
  'an unread SPY chain is an unknown market, not a volatile one',
  scoreAndJudge([passing()], ALL_ON, { spyRegime: null })[0].verdicts.spy.state ===
    'unknown',
);

section('Switching a rule off stops it counting but keeps its reading');

const offSettings = { ...ALL_ON, enabled: { ...ALL_ON.enabled, volume: false } };
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
  scoreRow(passing(), MARKET).missing.length === 0,
  JSON.stringify(scoreRow(passing(), MARKET).missing),
);
ok(
  'a name with no chain pulled drops gamma and option liquidity',
  scoreRow(row({ regime: null, optionsVolume: null, optionsOpenInterest: null }), MARKET)
    .missing.sort()
    .join(',') === 'optionLiquidity,tickerGamma',
);
ok(
  'an unread market drops the market component for everyone',
  scoreRow(passing(), { spyRegime: null }).missing.join(',') === 'spyGamma',
);

const measured = scoreRow(passing(), MARKET).total;
const unmeasured = scoreRow(
  passing({ regime: null, optionsVolume: null, optionsOpenInterest: null }),
  MARKET,
).total;
ok(
  'a dropped component renormalises rather than dragging the score to zero',
  unmeasured > measured - 20,
  `measured ${measured.toFixed(2)} vs unmeasured ${unmeasured.toFixed(2)}`,
);
ok(
  'an unmeasured gamma outranks a measured negative one',
  scoreRow(passing({ regime: null, optionsVolume: null, optionsOpenInterest: null }), MARKET)
    .total > scoreRow(passing({ regime: 'negative' }), MARKET).total,
  'scoring an absence as bad would be a claim about the request budget, not the stock',
);

ok(
  'the contract grade is not a scoring component at all',
  scoreRow(passing({ optionQuality: quality({ badge: 'avoid' }) }), MARKET).total ===
    scoreRow(passing({ optionQuality: quality({ badge: 'excellent' }) }), MARKET).total,
  'it filters and cautions; it must not move a name up or down the ranking',
);

ok(
  'a name with no readings at all scores zero rather than throwing',
  scoreRow(
    row({
      regime: null,
      optionsVolume: null,
      optionsOpenInterest: null,
      metrics: {
        rsScore: Number.NaN,
        m1Percentile: null,
        pctAbove200: null,
        ema200: null,
        pctAbove50: null,
        ema50: null,
        volumeRatio: null,
        pctAboveVwap: null,
        avgDollarVolume: 0,
      },
    }),
    { spyRegime: null },
  ).total === 0,
);

ok('every score is inside 0-100', (() => {
  const extremes = [
    passing(),
    row({ metrics: { rsScore: 0, pctAbove200: -80, pctAbove50: -60, volumeRatio: 0.01, pctAboveVwap: -70, m1Percentile: 0 } }),
    row({ metrics: { rsScore: 100, pctAbove200: 500, pctAbove50: 300, volumeRatio: 40, pctAboveVwap: 90, m1Percentile: 100 } }),
  ];
  return extremes.every((r) => {
    const t = scoreRow(r, MARKET).total;
    return Number.isFinite(t) && t >= 0 && t <= 100;
  });
})());

ok(
  'the weights cover exactly the seven components',
  Object.keys(SCORE_WEIGHTS).sort().join(',') === [...SCORE_KEYS].sort().join(','),
  Object.keys(SCORE_WEIGHTS).join(','),
);
ok(
  'relative strength counts double and everything else counts once',
  SCORE_WEIGHTS.rs === 2 &&
    SCORE_KEYS.filter((key) => key !== 'rs').every((key) => SCORE_WEIGHTS[key] === 1),
  JSON.stringify(SCORE_WEIGHTS),
);

section('The trend sub-score is four readings averaged, not ANDed');

const trendOf = (metrics) => trendScore({ ...passing().metrics, ...metrics });

ok(
  'all four good is 100',
  trendOf({ pctAbove50: 5, pctAbove200: 10, ema50: 100, ema200: 90, m1Percentile: 100 })
    .value === 100,
);
ok(
  'all four bad is 0',
  trendOf({ pctAbove50: -5, pctAbove200: -10, ema50: 90, ema200: 100, m1Percentile: 0 })
    .value === 0,
);
ok(
  'three of four beats none of four',
  trendOf({ pctAbove50: 5, pctAbove200: 10, ema50: 100, ema200: 90, m1Percentile: 0 }).value >
    trendOf({ pctAbove50: -5, pctAbove200: -10, ema50: 90, ema200: 100, m1Percentile: 0 })
      .value,
  'a boolean could not tell these apart, which is why the column exists',
);
ok(
  'a missing reading is left out rather than counted against the name',
  (() => {
    const partial = trendOf({
      pctAbove50: 5,
      pctAbove200: 10,
      ema50: 100,
      ema200: 90,
      m1Percentile: null,
    });
    return partial.value === 100 && partial.measured === 3;
  })(),
);
ok(
  'no readings at all is null, never zero',
  (() => {
    const none = trendOf({
      pctAbove50: null,
      pctAbove200: null,
      ema50: null,
      ema200: null,
      m1Percentile: null,
    });
    return none.value === null && none.measured === 0;
  })(),
);
ok(
  'the 50 above the 200 is read from the averages, not from price',
  trendOf({ ema50: 100, ema200: 90 }).parts.goldenOrder === true &&
    trendOf({ ema50: 90, ema200: 100 }).parts.goldenOrder === false,
);

section('The list is ordered by score, and the order is total');

const ordered = scoreAndJudge(
  [
    row({ symbol: 'LOW', metrics: { rsScore: 62, m1Percentile: 20, volumeRatio: 1 } }),
    row({ symbol: 'HIGH', metrics: { rsScore: 99, m1Percentile: 99, volumeRatio: 2.4 } }),
    row({ symbol: 'MID', metrics: { rsScore: 84, m1Percentile: 60, volumeRatio: 1.4 } }),
  ],
  D,
  MARKET,
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
    const a = scoreAndJudge([row({ symbol: 'ZZZ' }), row({ symbol: 'AAA' })], D, MARKET);
    const b = scoreAndJudge([row({ symbol: 'AAA' }), row({ symbol: 'ZZZ' })], D, MARKET);
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
  const lines = whyItRanks(judgeOne(r), ALL_ON);
  ok(`${label} has a Watch line last`, lines[lines.length - 1].label === 'Watch');
  ok(`${label} names the trend`, lines.some((l) => l.label === 'Trend'));
  ok(`${label} names the options`, lines.some((l) => l.label === 'Options'));
  ok(
    `${label} gives every line text`,
    lines.every((l) => l.text.length > 5),
    JSON.stringify(lines.map((l) => l.text)),
  );
}

section('Why it is on the list: built from the numbers, never for the row');

ok(
  'a strong name names its strengths',
  (() => {
    const line = whyItMatched(scoreRow(passing(), MARKET), passing());
    return /relative strength/i.test(line) && /200-day/i.test(line);
  })(),
  whyItMatched(scoreRow(passing(), MARKET), passing()),
);
ok(
  'and it never phrases the row as a trade',
  (() => {
    const rows = [
      passing(),
      passing({ regime: 'negative' }),
      row({ metrics: { rsScore: 30, m1Percentile: 5, pctAbove50: -9, pctAbove200: -12, ema50: 80, ema200: 95, volumeRatio: 0.4, pctAboveVwap: -6 } }),
    ];
    return rows.every((r) => {
      const line = whyItMatched(scoreRow(r, MARKET), r).toLowerCase();
      return !/\b(buy|sell|entry|enter|target|stop|position|long|short)\b/.test(line);
    });
  })(),
  'the one thing this line must never become',
);
ok(
  'a name with nothing strong says so rather than inventing a reason',
  (() => {
    const weakRow = row({
      regime: 'negative',
      optionsVolume: 900,
      optionsOpenInterest: 900,
      metrics: {
        rsScore: 25,
        m1Percentile: 5,
        pctAbove50: -9,
        pctAbove200: -12,
        ema50: 80,
        ema200: 95,
        volumeRatio: 0.55,
        pctAboveVwap: -6,
      },
    });
    return /nothing here scores strongly/i.test(
      whyItMatched(scoreRow(weakRow, { spyRegime: 'negative' }), weakRow),
    );
  })(),
);

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
  passing({
    symbol: 'NOTREND',
    metrics: { pctAbove200: -8, pctAbove50: -6, ema50: 80, ema200: 95, m1Percentile: 5 },
  }),
  passing({ symbol: 'NOVOL', metrics: { volumeRatio: 0.5 } }),
  passing({ symbol: 'UNDERVWAP', metrics: { pctAboveVwap: -2 } }),
  passing({ symbol: 'NEGGEX', regime: 'negative' }),
  passing({ symbol: 'THIN', metrics: { avgDollarVolume: 15_000_000 } }),
  row({ symbol: 'UNGRADED' }),
  passing({
    symbol: 'REPORTS',
    earnings: { state: 'known', dateIso: '2026-09-04', daysAway: 3, source: 'x' },
  }),
];

const judgedPop = scoreAndJudge(population, ALL_ON, MARKET);
const funnel = buildFunnel(judgedPop, ALL_ON);

ok('the first stage is everything scanned', funnel[0].count === population.length);
ok(
  'there is a stage per enabled filter plus earnings',
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
  'a disabled filter is not a stage',
  buildFunnel(judgedPop, offSettings).some((s) => s.key === 'volume') === false,
  'a step nothing fell out of is not a step',
);
ok(
  'at the shipped defaults only two filters are stages',
  buildFunnel(judgedPop, D).length === 4,
  buildFunnel(judgedPop, D)
    .map((s) => s.key)
    .join(','),
);
ok(
  'a funnel that reaches zero still leaves the whole ranking behind it',
  (() => {
    const strict = { ...ALL_ON, rsMin: 99 };
    const nobodyMatches = buildFunnel(
      scoreAndJudge(population, strict, MARKET),
      strict,
    );
    return (
      nobodyMatches[nobodyMatches.length - 1].count === 0 &&
      judgedPop.length === population.length
    );
  })(),
  'the count going to zero must not take the table with it',
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
  sameSettings(settingsFromParams(new URLSearchParams('')), D),
);

const custom = {
  ...D,
  rsMin: 71,
  trendMin: 64,
  volumeMult: 1.65,
  minDollarVolume: 40_000_000,
  dteMin: 14,
  dteMax: 90,
  deltaMin: 0.3,
  deltaMax: 0.85,
  earningsBufferDays: 21,
  // Both directions at once: one filter switched off that ships on, and two
  // switched on that ship off. A link that could only carry one direction
  // would silently lose half of every shared configuration.
  enabled: { ...D.enabled, liquidity: false, vwap: true, gamma: true },
};

const roundTripped = settingsFromParams(new URLSearchParams(paramsFromSettings(custom)));
ok(
  'every control survives the round trip',
  sameSettings(roundTripped, custom),
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
  'an unknown filter name in the off-list is ignored',
  settingsFromParams(new URLSearchParams('off=nonsense')).enabled.rs === true,
);
ok(
  'a filter switched on that ships off survives the link',
  settingsFromParams(new URLSearchParams('on=vwap')).enabled.vwap === true,
);
ok(
  'and one switched off that ships on survives too',
  settingsFromParams(new URLSearchParams('off=rs')).enabled.rs === false,
);
ok(
  'every clamped setting stays inside its slider bounds',
  (() => {
    const wild = clampSettings({
      ...D,
      rsMin: -50,
      volumeMult: 900,
      minDollarVolume: -1,
      trendMin: 9999,
      earningsBufferDays: -4,
      deltaMin: -1,
      deltaMax: 40,
    });
    const b = FILTER_BOUNDS;
    return (
      wild.rsMin >= b.rsMin.min &&
      wild.volumeMult <= b.volumeMult.max &&
      wild.minDollarVolume >= b.minDollarVolume.min &&
      wild.trendMin <= b.trendMin.max &&
      wild.earningsBufferDays >= b.earningsBufferDays.min &&
      wild.deltaMin >= b.delta.min &&
      wild.deltaMax <= b.delta.max
    );
  })(),
);

// --- 10. the list is never empty --------------------------------------------

section('The page always has rows, however many pass');

ok('the page renders a fixed twenty rows', SCANNER_TOP_N === 20, String(SCANNER_TOP_N));

ok(
  'a population where nothing matches still ranks every name',
  (() => {
    const nobody = scoreAndJudge(
      [
        passing({ symbol: 'A', metrics: { rsScore: 20 } }),
        passing({ symbol: 'B', metrics: { rsScore: 30 } }),
        passing({ symbol: 'C', metrics: { rsScore: 40 } }),
      ],
      D,
      MARKET,
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
  scoreAndJudge([passing({ metrics: { rsScore: 20 } })], D, MARKET).every(
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
