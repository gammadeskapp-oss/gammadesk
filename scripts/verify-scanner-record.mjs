/*
 * Validation of the scanner's track record — the summary maths and the
 * forward-return arithmetic.
 *
 * Why this file exists: this is the one page on the site whose entire purpose
 * is to be trusted about its own performance, and every plausible bug in it
 * fails in the flattering direction. Count a pending horizon as a zero and the
 * hit rate improves. Drop an entry whose price could not be read and the worst
 * picks leave the sample first. Round a flat close up into the hit count and
 * the headline number goes up. So the table below spends most of its rows on
 * the losing and unfinished cases.
 *
 * The properties checked here:
 *
 *  1. An unfilled horizon is never counted. Not as zero, not as flat, not as
 *     anything — it is out of the sample until it is real.
 *  2. Losing picks are in every number. The average counts them, the sample
 *     counts them, and nothing in the summary can exclude them.
 *  3. The sample-size banner fires below the stated threshold and the
 *     threshold is the one number that decides it.
 *  4. Forward returns are counted in trading sessions off the price series, so
 *     a weekend or a holiday cannot silently shorten a five-day return.
 *
 * Run: npm run verify:scanner-record
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const {
  summariseTrackRecord,
  HONEST_SAMPLE_SIZE,
  HORIZONS,
  horizonKey,
} = await import('../src/lib/trackRecord/types.ts');
const { closeAfter, closeOn } = await import('../src/lib/trackRecord/sessions.ts');

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

/**
 * One logged pick. `forward` is given as plain percentages for brevity; a
 * missing key means the horizon has not been filled in, which is the state
 * this whole file exists to keep distinct from zero.
 */
function entry(symbol, date, forward = {}, over = {}) {
  const filled = {};
  for (const [key, pct] of Object.entries(forward)) {
    filled[key] = { pct, close: 100 * (1 + pct / 100), closeDate: '2026-09-08' };
  }
  return {
    date,
    loggedAt: `${date}T20:15:00.000Z`,
    symbol,
    rank: 1,
    score: 82,
    components: { rs: 91, trend: 75 },
    rsRank: 14,
    close: 100,
    closeSource: 'test',
    forward: filled,
    ...over,
  };
}

// --- 1. pending is never counted --------------------------------------------

section('An unfilled horizon is out of the sample, not a zero in it');

const mixed = summariseTrackRecord([
  entry('AAA', '2026-09-01', { d1: 1, d3: 2, d5: 4 }),
  entry('BBB', '2026-09-02', { d1: -1 }),
  entry('CCC', '2026-09-03', {}),
]);

ok('everything logged is counted as logged', mixed.logged === 3, String(mixed.logged));
ok(
  'only the finished one counts as settled',
  mixed.settled === 1,
  String(mixed.settled),
);
ok(
  'the five-day sample is one, not three',
  mixed.byHorizon.d5.sample === 1,
  'a pick from Tuesday has not lost, it has not finished',
);
ok('the one-day sample is two', mixed.byHorizon.d1.sample === 2);
ok(
  'an entry with no returns at all contributes to nothing but the log count',
  mixed.byHorizon.d1.sample === 2 && mixed.byHorizon.d3.sample === 1,
);
ok(
  'a pending horizon does not drag the average toward zero',
  mixed.byHorizon.d5.averagePct === 4,
  String(mixed.byHorizon.d5.averagePct),
);

const empty = summariseTrackRecord([]);
ok('an empty record reports null rather than 0%', empty.byHorizon.d5.hitRatePct === null);
ok('and a null average', empty.byHorizon.d5.averagePct === null);
ok('and no best or worst', empty.byHorizon.d5.best === null && empty.byHorizon.d5.worst === null);
ok('and no window', empty.from === null && empty.to === null);
ok('and it is flagged as too small', empty.tooSmall === true);

// --- 2. losers are in every number ------------------------------------------

section('Losing picks are counted everywhere');

const withLosers = summariseTrackRecord([
  entry('WIN', '2026-09-01', { d5: 10 }),
  entry('LOSE', '2026-09-02', { d5: -8 }),
  entry('FLAT', '2026-09-03', { d5: 0 }),
  entry('BAD', '2026-09-04', { d5: -20 }),
]);

const five = withLosers.byHorizon.d5;

ok('every settled pick is in the sample', five.sample === 4, String(five.sample));
ok(
  'the average counts the losses',
  Math.abs(five.averagePct - (10 - 8 + 0 - 20) / 4) < 1e-9,
  String(five.averagePct),
);
ok(
  'the average is negative when the picks were',
  five.averagePct < 0,
  'nothing in the summary can turn four picks averaging -4.5% into a positive number',
);
ok(
  'a flat close is in the sample and out of the hit count',
  five.positive === 1 && five.sample === 4,
  `${five.positive} positive of ${five.sample}`,
);
ok('the hit rate is 25%', five.hitRatePct === 25, String(five.hitRatePct));
ok('the worst pick is reported, not hidden', five.worst.symbol === 'BAD' && five.worst.pct === -20);
ok('the best is reported too', five.best.symbol === 'WIN' && five.best.pct === 10);
ok(
  'best and worst name the pick and the day, so either can be checked',
  five.best.date === '2026-09-01' && five.worst.date === '2026-09-04',
);

ok(
  'the summary takes no argument that could narrow it',
  summariseTrackRecord.length === 1,
  'a date range or a minimum score would be a filter for making this look better',
);

// --- 3. the sample-size banner ----------------------------------------------

section('The sample-size warning is decided by one number');

const many = (n, pct) =>
  Array.from({ length: n }, (_, i) =>
    entry(`S${i}`, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, { d5: pct }),
  );

ok(`under ${HONEST_SAMPLE_SIZE} is too small`, summariseTrackRecord(many(HONEST_SAMPLE_SIZE - 1, 3)).tooSmall);
ok(`exactly ${HONEST_SAMPLE_SIZE} is not`, !summariseTrackRecord(many(HONEST_SAMPLE_SIZE, 3)).tooSmall);
ok(
  'a pile of unsettled picks does not lift the banner',
  summariseTrackRecord([
    ...many(HONEST_SAMPLE_SIZE - 1, 3),
    ...Array.from({ length: 40 }, (_, i) => entry(`P${i}`, '2026-09-20', { d1: 5 })),
  ]).tooSmall,
  'the banner is decided by settled picks, not by how busy the logger has been',
);
ok(
  'the threshold is a shared constant rather than a literal in the page',
  typeof HONEST_SAMPLE_SIZE === 'number' && HONEST_SAMPLE_SIZE >= 30,
  String(HONEST_SAMPLE_SIZE),
);

// --- 4. the window ----------------------------------------------------------

section('The window spans every logged pick');

const windowed = summariseTrackRecord([
  entry('A', '2026-09-04', { d5: 1 }),
  entry('B', '2026-09-01', { d5: 1 }),
  entry('C', '2026-09-09', {}),
]);
ok('from is the earliest logged date', windowed.from === '2026-09-01', windowed.from);
ok(
  'to is the latest, settled or not',
  windowed.to === '2026-09-09',
  'an unsettled pick is still part of the history',
);

ok(
  'every horizon in the spec has a stats block',
  HORIZONS.every((days) => !!windowed.byHorizon[horizonKey(days)]),
  HORIZONS.join(','),
);
ok('the horizons are 1, 3 and 5', HORIZONS.join(',') === '1,3,5');

// --- 5. forward returns count trading sessions ------------------------------

section('Forward returns are counted in sessions, off the price series itself');

/* A fortnight of sessions with a weekend and a Monday holiday in it. */
const series = {
  dates: [
    '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
    // 5th and 6th are a weekend, 7th a holiday — absent from the series.
    '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
    '2026-09-14', '2026-09-15',
  ],
  closes: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109],
};

ok('the anchor close is read by exact date', closeOn(series, '2026-09-03') === 102);
ok('a date not in the series has no close', closeOn(series, '2026-09-07') === null);

ok(
  'one session on is the next trading day, not the next calendar day',
  closeAfter(series, '2026-09-04', 1).date === '2026-09-08',
  'the weekend and the holiday are skipped because the series never had them',
);
ok('and it carries that session’s close', closeAfter(series, '2026-09-04', 1).close === 104);
ok(
  'five sessions on spans five sessions of trading',
  closeAfter(series, '2026-09-02', 5).date === '2026-09-10',
);
ok(
  'a horizon that has not happened yet is null, never the last close',
  closeAfter(series, '2026-09-15', 1) === null,
  'returning the most recent close would invent a 0% return for every fresh pick',
);
ok(
  'and so is a horizon that runs off the end',
  closeAfter(series, '2026-09-14', 5) === null,
);
ok(
  'an anchor date the series does not have yields nothing',
  closeAfter(series, '2026-09-07', 1) === null,
);

ok(
  'the return arithmetic is a plain percentage change',
  (() => {
    const anchor = closeOn(series, '2026-09-01');
    const future = closeAfter(series, '2026-09-01', 5);
    const pct = ((future.close - anchor) / anchor) * 100;
    return Math.abs(pct - 5) < 1e-9;
  })(),
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
