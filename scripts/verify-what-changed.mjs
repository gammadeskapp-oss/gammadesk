/*
 * Validation of the what-changed lines, src/lib/whatChanged/index.ts, and of
 * the previous-trading-day walk they depend on.
 *
 * Why this file exists: this feature has exactly one dangerous failure, and it
 * has already happened once. Compare today against an empty or partial store
 * and every difference reads as an improvement — names "arrive" that were
 * always there, a level is "regained" that was never lost. The rule is that a
 * source with no prior session says nothing at all, and the cases below exist
 * to keep it that way.
 *
 * The second half checks that "the previous session" means the previous
 * TRADING day. A calendar subtraction lands on Sunday every Monday, and the
 * card would go blank one day in five.
 *
 * Run: npm run verify:what-changed
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { buildWhatChanged, MAX_LINES } = await import('../src/lib/whatChanged/index.ts');
const { previousSessionDate } = await import('../src/lib/staleness.ts');
const { sessionRules } = await import('../src/lib/events/rules.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function eqLines(label, actual, expected) {
  ok(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** A log entry sitting above its flip level unless told otherwise. */
function entry(date, over = {}) {
  return {
    date,
    snapshotAt: `${date}T13:45:00.000Z`,
    regime: 'positive',
    flipLevel: 640,
    spotAtSnapshot: 645,
    magnetAbove: 650,
    magnetBelow: 630,
    netGex: 1e9,
    settled: true,
    ...over,
  };
}

/** An archived scanner morning holding the given symbols. */
function scan(date, symbols) {
  return {
    date,
    scannedAt: `${date}T13:50:00.000Z`,
    passed: symbols.length,
    candidates: symbols.length + 10,
    universe: 500,
    rsMin: 80,
    spyRegime: 'positive',
    gateReason: null,
    earningsExcluded: 0,
    qualityChecked: symbols.length,
    names: symbols.map((symbol, i) => ({
      symbol,
      score: 90 - i,
      rank: i + 1,
      badges: [],
      optionBadge: null,
      contract: null,
      optionSource: null,
      watch: 'placeholder',
      earningsDateIso: null,
    })),
  };
}

const TODAY = '2026-08-31';
const PRIOR = '2026-08-28';

function build(over = {}) {
  return buildWhatChanged({
    symbol: 'SPY',
    today: TODAY,
    prior: PRIOR,
    log: [],
    archive: [],
    ...over,
  });
}

console.log('What changed');

// --- the missing-snapshot rule, which is the whole point -------------------
eqLines('empty stores say nothing', build(), []);

eqLines(
  'today only, no prior log entry',
  build({ log: [entry(TODAY, { spotAtSnapshot: 635 })] }),
  [],
);

eqLines(
  'today only, no prior scan - the false-green case',
  build({ archive: [scan(TODAY, ['AAPL', 'NVDA', 'MSFT'])] }),
  [],
);

eqLines(
  'prior only, nothing stored for today',
  build({ archive: [scan(PRIOR, ['AAPL'])] }),
  [],
);

eqLines(
  'prior session unknown to the calendar',
  buildWhatChanged({
    symbol: 'SPY',
    today: TODAY,
    prior: null,
    log: [entry(TODAY, { spotAtSnapshot: 635 }), entry(PRIOR)],
    archive: [],
  }),
  [],
);

// A gap is not a prior session. The store holds a day, but not the one asked
// for, and the wrong day must never be substituted for the right one.
eqLines(
  'store holds a different day than the prior session',
  build({ archive: [scan(TODAY, ['AAPL', 'NVDA']), scan('2026-08-20', ['AAPL'])] }),
  [],
);

// --- the volatility threshold ---------------------------------------------
eqLines(
  'moved back above',
  build({
    log: [entry(TODAY), entry(PRIOR, { spotAtSnapshot: 635 })],
  }),
  ['SPY moved back above its modeled volatility threshold.'],
);

// The decline, which must appear as readily as the improvement above.
eqLines(
  'moved below',
  build({
    log: [entry(TODAY, { spotAtSnapshot: 635 }), entry(PRIOR)],
  }),
  ['SPY moved below its modeled volatility threshold.'],
);

eqLines(
  'same side is not a change',
  build({ log: [entry(TODAY), entry(PRIOR)] }),
  [],
);

// Null is not a side. Neither day can be placed, so nothing is claimed.
eqLines(
  'no flip level either day',
  build({
    log: [entry(TODAY, { flipLevel: null }), entry(PRIOR, { flipLevel: null })],
  }),
  [],
);

eqLines(
  'flip level appeared today, absent yesterday',
  build({
    log: [entry(TODAY), entry(PRIOR, { flipLevel: null })],
  }),
  [],
);

// --- the scanner shortlist -------------------------------------------------
eqLines(
  'three entered',
  build({
    archive: [
      scan(TODAY, ['AAPL', 'NVDA', 'MSFT', 'AMD']),
      scan(PRIOR, ['AAPL']),
    ],
  }),
  ['Three stocks entered the scanner shortlist.'],
);

eqLines(
  'two left',
  build({
    archive: [scan(TODAY, ['AAPL']), scan(PRIOR, ['AAPL', 'NVDA', 'MSFT'])],
  }),
  ['Two stocks left the scanner shortlist.'],
);

eqLines(
  'one entered reads singular',
  build({
    archive: [scan(TODAY, ['AAPL', 'NVDA']), scan(PRIOR, ['AAPL'])],
  }),
  ['One stock entered the scanner shortlist.'],
);

// Churn in both directions. The bigger move leads, and the decline is not
// dropped for being the unwelcome half.
eqLines(
  'both directions, larger first',
  build({
    archive: [
      scan(TODAY, ['AAPL', 'NVDA']),
      scan(PRIOR, ['AAPL', 'TSLA', 'AMD', 'MU']),
    ],
  }),
  [
    'Three stocks left the scanner shortlist.',
    'One stock entered the scanner shortlist.',
  ],
);

eqLines(
  'same names either day',
  build({
    archive: [scan(TODAY, ['AAPL', 'NVDA']), scan(PRIOR, ['NVDA', 'AAPL'])],
  }),
  [],
);

// An empty shortlist on both days is a real, comparable state - and still no
// change. This is distinct from the store having no entry at all.
eqLines(
  'shortlist empty both days',
  build({ archive: [scan(TODAY, []), scan(PRIOR, [])] }),
  [],
);

eqLines(
  'shortlist emptied out',
  build({ archive: [scan(TODAY, []), scan(PRIOR, ['AAPL', 'NVDA'])] }),
  ['Two stocks left the scanner shortlist.'],
);

// --- ordering and the cap --------------------------------------------------
const busy = build({
  log: [entry(TODAY, { spotAtSnapshot: 635 }), entry(PRIOR)],
  archive: [
    scan(TODAY, ['AAPL', 'NVDA']),
    scan(PRIOR, ['AAPL', 'TSLA', 'AMD', 'MU']),
  ],
});
eqLines('the character of the day leads the shortlist churn', busy, [
  'SPY moved below its modeled volatility threshold.',
  'Three stocks left the scanner shortlist.',
  'One stock entered the scanner shortlist.',
]);
ok('never more than the cap', busy.length <= MAX_LINES, `got ${busy.length}`);

// --- previous TRADING day, not yesterday ----------------------------------
const rules = sessionRules({ marketCalendar: [] });

// The Monday case this was built for.
ok(
  'Monday looks back to Friday',
  previousSessionDate('2026-08-31', rules) === '2026-08-28',
  previousSessionDate('2026-08-31', rules),
);
ok(
  'Tuesday looks back to Monday',
  previousSessionDate('2026-08-25', rules) === '2026-08-24',
  previousSessionDate('2026-08-25', rules),
);
ok(
  'Saturday looks back to Friday',
  previousSessionDate('2026-08-29', rules) === '2026-08-28',
  previousSessionDate('2026-08-29', rules),
);

// A holiday is skipped like a weekend. Christmas 2026 falls on a Friday, so
// the session before Monday the 28th is Thursday the 24th.
const withHoliday = sessionRules({
  marketCalendar: [{ date: '2026-12-25', status: 'closed' }],
});
ok(
  'holiday is skipped',
  previousSessionDate('2026-12-28', withHoliday) === '2026-12-24',
  previousSessionDate('2026-12-28', withHoliday),
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
