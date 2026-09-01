/*
 * Validation of the append-only session series, src/lib/history/session.ts,
 * and a printed sample row.
 *
 * Why this file exists: this series cannot be backfilled. Whatever the evening
 * job fails to record is gone for that session forever, and a field added
 * later starts empty while every earlier row stays blank. So the shape has to
 * be right on the first evening, not the third — which means the checks below
 * are about what the row can DISTINGUISH more than what it contains:
 *
 *   - a real value, `null` (ran, nothing there) and absent (not recorded yet)
 *     must stay three different states, not two
 *   - a stale sectors snapshot must be detectable, so a refresh that quietly
 *     failed cannot be read back as that session's sector state
 *   - a re-run must replace its own row rather than duplicate the session
 *
 * The sample row at the end is built from the readings that were actually live
 * on the deployment when this was written, so the shape can be read as it will
 * really be stored.
 *
 * Run: npm run verify:session-history
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { buildSessionRow, upsertRow, sectorsAreCurrent, KEEP_SESSIONS, SESSION_HISTORY_SCHEMA } =
  await import('../src/lib/history/session.ts');

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

const NOW = new Date('2026-09-01T22:20:00.000Z');

/** A breadth reading shaped exactly as `getBreadth` returns it. */
function breadth(over = {}) {
  return {
    computed: {
      at: '2026-09-01T19:59:00.000Z',
      etClock: '15:59',
      pctAbovePriorClose: 48,
      pctAboveSessionAverage: 41,
      ...(over.computed ?? {}),
    },
    source: 'tradier',
    spread: null,
    series: [],
    ...over,
  };
}

/** A sectors snapshot shaped as the store holds it. */
function sectors(asOfDate, list) {
  return {
    schema: 3,
    asOfDate,
    computedAt: `${asOfDate}T22:10:00.000Z`,
    sessions: 10,
    notes: [],
    sectors: list.map(([id, score, delta1, label]) => ({
      id,
      name: id,
      blurb: '',
      members: [],
      failures: [],
      series: [],
      score,
      delta1,
      delta3: null,
      delta5: null,
      rsiLow: 0,
      rsiHigh: 0,
      rsiNow: 0,
      flag: null,
      consensus: { bullish: 6, total: 9, label },
    })),
  };
}

const LIVE_SECTORS = [
  ['information-technology', 58, 2.2, 'BULLISH'],
  ['real-estate', 51, -4.4, 'NEUTRAL'],
];

console.log('Session history');

// --- the three states ------------------------------------------------------
const full = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth(),
  sectors: sectors('2026-09-01', LIVE_SECTORS),
  now: NOW,
});

eq('breadth value is copied, not recomputed', full.breadth.pctAbovePriorClose, 48);
eq('the sample time is kept, not the write time', full.breadth.sampleAt, '2026-09-01T19:59:00.000Z');
ok('the write time is separate', full.recordedAt === NOW.toISOString(), full.recordedAt);
eq('sectors are trimmed to four fields', Object.keys(full.sectors[0]).sort(), [
  'delta1',
  'id',
  'label',
  'score',
]);

// Null, never an omitted key. The job ran; the value was not there. A reader
// must be able to tell this from a row written before breadth was recorded.
const noBreadth = buildSessionRow({
  date: '2026-09-01',
  breadth: null,
  sectors: sectors('2026-09-01', LIVE_SECTORS),
  now: NOW,
});
ok('missing breadth is present and null', 'breadth' in noBreadth && noBreadth.breadth === null);

// A reading that exists but produced no sample all day is the same fact.
const emptySweep = buildSessionRow({
  date: '2026-09-01',
  breadth: { computed: null, source: null, spread: null, series: [] },
  sectors: null,
  now: NOW,
});
ok('a sweep with no sample is null', emptySweep.breadth === null);
ok('missing sectors is present and null', 'sectors' in emptySweep && emptySweep.sectors === null);
ok('and carries no asOf to mislead anyone', emptySweep.sectorsAsOf === null);

// An empty sector list is not an empty market — it is a failed refresh.
const noSectors = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth(),
  sectors: sectors('2026-09-01', []),
  now: NOW,
});
ok('an empty sector list stores null, not []', noSectors.sectors === null);

// Zero is a real reading and must survive. Falsy-checking this field would
// erase the most interesting session the series will ever hold.
const zero = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth({ computed: { pctAbovePriorClose: 0, pctAboveSessionAverage: 0 } }),
  sectors: null,
  now: NOW,
});
ok('breadth of zero is recorded, not dropped', zero.breadth?.pctAbovePriorClose === 0);

// --- the stale sectors case -----------------------------------------------
// This is not hypothetical: on the day this was written the deployed sectors
// snapshot was dated 2026-08-31 while the session was 2026-09-01.
const stale = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth(),
  sectors: sectors('2026-08-31', LIVE_SECTORS),
  now: NOW,
});
eq('a stale snapshot records its own date', stale.sectorsAsOf, '2026-08-31');
ok('and is not current', sectorsAreCurrent(stale) === false);
ok('the values are still kept', stale.sectors.length === 2);
ok('a matching snapshot is current', sectorsAreCurrent(full) === true);
ok('a null sector half is never current', sectorsAreCurrent(emptySweep) === false);

// --- the two failure paths the sectors route has to survive ---------------
/*
 * These are the reasons the history write lives in /api/sectors/refresh rather
 * than in the digest job ten minutes later. Both model what `recordSession`
 * receives in each case; the route decides which one it hands over.
 */

// OVERRUN. The refresh is still running when something else wants the row, so
// the store still holds yesterday's document. Under the old plan the digest
// job would have read exactly this and stamped it as tonight's sector state.
const overrun = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth(),
  sectors: sectors('2026-08-31', LIVE_SECTORS),
  now: NOW,
});
ok('an overrun records the session', overrun.date === '2026-09-01');
ok('breadth survives an overrun', overrun.breadth?.pctAbovePriorClose === 48);
ok('the stale sector half is not passed off as tonight', sectorsAreCurrent(overrun) === false);
eq('and its real date is preserved', overrun.sectorsAsOf, '2026-08-31');

// THROW. The refresh failed outright, so the route passes no snapshot and
// `recordSession` falls back to the stored one. Same shape as the overrun —
// which is the point: a row is still written either way, and the session's
// breadth is never lost to a sector failure.
const threw = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth(),
  sectors: sectors('2026-08-31', LIVE_SECTORS),
  now: NOW,
});
ok('a throw still records the session', threw.date === '2026-09-01');
ok('breadth survives a throw', threw.breadth !== null);
ok('the sector half is flagged, not silently trusted', sectorsAreCurrent(threw) === false);

// THROW WITH NOTHING STORED AT ALL. Nothing to fall back to, so the sector
// half is null — and the row is still written, because the breadth half is
// the part that cannot be recovered tomorrow.
const threwEmpty = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth(),
  sectors: null,
  now: NOW,
});
ok('a row is written with no sectors at all', threwEmpty.date === '2026-09-01');
ok('breadth is still captured', threwEmpty.breadth?.pctAbovePriorClose === 48);
ok('the sector half is null', threwEmpty.sectors === null);
ok('and never reads as current', sectorsAreCurrent(threwEmpty) === false);

// The success path the route now guarantees: the snapshot handed over is the
// one just computed, so its date matches by construction.
const handedOver = buildSessionRow({
  date: '2026-09-01',
  breadth: breadth(),
  sectors: sectors('2026-09-01', LIVE_SECTORS),
  now: NOW,
});
ok('a handed-over snapshot is current', sectorsAreCurrent(handedOver) === true);

// --- upsert ----------------------------------------------------------------
const empty = { schema: SESSION_HISTORY_SCHEMA, rows: [] };
const one = upsertRow(empty, full);
eq('first row lands', one.rows.length, 1);

const rerun = upsertRow(one, buildSessionRow({
  date: '2026-09-01',
  breadth: breadth({ computed: { pctAbovePriorClose: 52 } }),
  sectors: sectors('2026-09-01', LIVE_SECTORS),
  now: NOW,
}));
eq('a re-run replaces rather than duplicates', rerun.rows.length, 1);
eq('and the later value wins', rerun.rows[0].breadth.pctAbovePriorClose, 52);

const twoDays = upsertRow(rerun, buildSessionRow({
  date: '2026-08-31',
  breadth: breadth(),
  sectors: null,
  now: NOW,
}));
eq('newest first', twoDays.rows.map((r) => r.date), ['2026-09-01', '2026-08-31']);

let many = { schema: SESSION_HISTORY_SCHEMA, rows: [] };
for (let i = 0; i < KEEP_SESSIONS + 25; i += 1) {
  const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
  many = upsertRow(many, buildSessionRow({ date: d, breadth: breadth(), sectors: null, now: NOW }));
}
eq('the window is capped', many.rows.length, KEEP_SESSIONS);
ok('and it is the oldest that fall off', many.rows[0].date > many.rows[many.rows.length - 1].date);

console.log(`\n${checks - failures}/${checks} checks passed`);

// --- the sample row --------------------------------------------------------
console.log('\nSample row, from the readings live on the deployment:\n');
console.log(JSON.stringify(stale, null, 2));
console.log(
  `\nsectorsAreCurrent -> ${sectorsAreCurrent(stale)}  (snapshot says ${stale.sectorsAsOf}, session is ${stale.date})`,
);

if (failures > 0) process.exit(1);
