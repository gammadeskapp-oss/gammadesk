/*
 * Validation of the volume-weighted "Today's activity" view.
 *
 * Two modules are the subject: the weighting in src/lib/exposure.ts, and the
 * cross-weighting match in src/lib/decision/activity.ts. Node strips the types
 * and the fixtures are hand-built so every expected answer is reasoned out
 * first.
 *
 * What this exists to catch:
 *
 *   1. The open-interest view quietly changing. The whole feature rests on the
 *      promise that the main numbers are untouched. The snapshot now also
 *      carries volume-only contracts (zero open interest, traded today); if
 *      `buildPositioning` ever stopped filtering those out for the OI basis,
 *      they would shift a displayed strike or the flip and nobody would see it
 *      in the diff. The invariant test adds exactly such contracts and asserts
 *      the OI result is bit-for-bit unchanged.
 *
 *   2. The volume basis not actually using volume. If the weighting fell back
 *      to open interest, the two views would agree whenever OI and volume
 *      disagree — which is precisely when the feature earns its place.
 *
 *   3. The confirm tag matching the wrong things: a near-miss strike, a flip
 *      that drifted further than the tolerance, or a strike "confirming" a flip
 *      at the same price. Each renders as a plausible badge on the wrong level.
 *
 * Run: npm run verify:activity
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();
const { buildPositioning, contractMetrics } = await import('../src/lib/exposure.ts');
const { confirmedByVolume } = await import('../src/lib/decision/activity.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}`);
  if (detail !== undefined) console.error(`        ${detail}`);
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${expected}, got ${actual}`);
}

function near(label, actual, expected, tol = 1e-9) {
  ok(label, Math.abs(actual - expected) <= tol, `expected ~${expected}, got ${actual}`);
}

const META = {
  source: 'cboe',
  sourceLabel: 'Cboe (delayed)',
  asOfLabel: 'test',
  asOfIso: '2026-09-20T00:00:00.000Z',
  quoteDateLabel: 'test',
  quoteDateIso: '2026-09-20T00:00:00.000Z',
  cacheSeconds: 60,
  upstreamRequests: 1,
  riskFreeRate: 0.04,
  dividendYield: 0,
  notes: [],
};

const SPOT = 100;

/** One normalised contract, with iv/T supplied so no surface solve is needed. */
function contract(strike, type, expiration, openInterest, volume, T = 0.02) {
  return {
    ticker: `${expiration}-${strike}-${type}`,
    type,
    strike,
    expiration,
    openInterest,
    volume,
    iv: 0.2,
    ivSource: 'quoted',
    T,
  };
}

function options(weightBy) {
  return {
    symbol: 'TEST',
    spot: SPOT,
    riskFreeRate: 0.04,
    dividendYield: 0,
    expirationCount: 5,
    strikesEachSide: 30,
    weightBy,
    meta: META,
  };
}

const NEAR = '2026-09-21';
const FAR = '2026-09-25';

console.log('\nactivity view\n');

// --- weighting basis on one contract ---------------------------------------
{
  // A single contract's gamma scales linearly with the count it is weighted by,
  // so a contract with 300 OI and 100 volume has exactly 3x the GEX under OI.
  const c = contract(100, 'call', NEAR, 300, 100);
  const params = { spot: SPOT, riskFreeRate: 0.04, dividendYield: 0 };
  const byOi = contractMetrics(c, params, 'openInterest');
  const byVol = contractMetrics(c, params, 'volume');
  ok('OI and volume weightings differ', byOi.gex !== byVol.gex);
  near('the ratio is the count ratio', byOi.gex / byVol.gex, 3, 1e-9);
  eq('the default basis is open interest', contractMetrics(c, params).gex, byOi.gex);
}

// --- the invariant: volume-only contracts never touch the OI view ----------
{
  // A book that carries open interest, some of it also traded today.
  const base = [
    contract(105, 'call', NEAR, 400, 50),
    contract(102, 'call', NEAR, 200, 900),
    contract(98, 'put', NEAR, 200, 900),
    contract(95, 'put', NEAR, 400, 50),
    contract(105, 'call', FAR, 150, 10),
    contract(95, 'put', FAR, 150, 10),
  ];

  // The same book plus contracts that opened today: zero open interest, real
  // volume, and at strikes the OI book does not even list.
  const withVolumeOnly = [
    ...base,
    contract(103, 'call', NEAR, 0, 5000),
    contract(101, 'call', NEAR, 0, 4000),
    contract(99, 'put', NEAR, 0, 4000),
    contract(97, 'put', NEAR, 0, 5000),
  ];

  const oiBase = buildPositioning(base, options('openInterest'));
  const oiWith = buildPositioning(withVolumeOnly, options('openInterest'));

  near('net GEX is unchanged by volume-only contracts', oiWith.grandTotal.gex, oiBase.grandTotal.gex, 1e-6);
  eq('the flip is unchanged', oiWith.summary.flipLevel, oiBase.summary.flipLevel);
  eq('the strike count is unchanged', oiWith.rows.length, oiBase.rows.length);
  ok(
    'every OI strike keeps its exact gamma',
    oiWith.rows.every((r, i) => Math.abs(r.total.gex - oiBase.rows[i].total.gex) < 1e-6),
    'a volume-only contract leaked into the open-interest view',
  );
  // The zero-OI strikes must not appear at all in the OI view.
  const oiStrikes = new Set(oiWith.rows.map((r) => r.strike));
  ok('a zero-OI, traded strike is absent from the OI view', !oiStrikes.has(103));

  // The volume view, by contrast, is built from those very strikes.
  const vol = buildPositioning(withVolumeOnly, options('volume'));
  const volStrikes = new Set(vol.rows.map((r) => r.strike));
  ok('the traded-only strike is present in the volume view', volStrikes.has(103));
  ok(
    'the volume view weights by volume, not OI',
    Math.abs(vol.grandTotal.gex - oiWith.grandTotal.gex) > 1e-3,
    'the volume basis produced the same net GEX as open interest',
  );
  // 105 holds the most open interest; 102/98 and the fresh 103/97 hold the most
  // volume. So the heaviest strike differs between the two weightings.
  const heaviest = (p) =>
    p.rows.reduce((a, b) => (Math.abs(b.total.gex) > Math.abs(a.total.gex) ? b : a)).strike;
  ok('the heaviest strike moves with the weighting', heaviest(vol) !== heaviest(oiWith), `both ${heaviest(vol)}`);
}

// --- an empty session: nothing traded --------------------------------------
{
  const book = [
    contract(105, 'call', NEAR, 400, 0),
    contract(95, 'put', NEAR, 400, 0),
  ];
  const vol = buildPositioning(book, options('volume'));
  eq('no traded contracts means no volume rows', vol.rows.length, 0);
  eq('and no volume flip', vol.summary.flipLevel, null);
  // The OI view of the same book is unaffected.
  const oi = buildPositioning(book, options('openInterest'));
  eq('the OI view still has its strikes', oi.rows.length, 2);
}

// --- confirmedByVolume: strike exact, flip within tolerance ----------------
{
  const spot = 100;
  const strikeRung = (price, kind) => ({
    price,
    labels: [kind],
    gex: 100,
    distancePct: ((price - spot) / spot) * 100,
    isSpot: false,
  });
  const flipRung = (price) => ({
    price,
    labels: ['flip'],
    gex: null,
    distancePct: ((price - spot) / spot) * 100,
    isSpot: false,
  });
  const spotRung = { price: spot, labels: ['spot'], gex: null, distancePct: 0, isSpot: true };

  const standard = {
    rungs: [strikeRung(105, 'ceiling'), spotRung, strikeRung(95, 'floor'), flipRung(98.5)],
  };
  // Activity confirms 105 (same strike) and the flip (98.45 is 0.05% away, inside
  // the tenth-of-a-percent tolerance). It does NOT confirm 95: its nearest
  // strike is 96, a different strike.
  const activity = {
    rungs: [strikeRung(105, 'wall'), spotRung, strikeRung(96, 'floor'), flipRung(98.45)],
  };

  const confirmed = confirmedByVolume(standard, activity, spot);
  ok('the shared ceiling is confirmed', confirmed.includes(105));
  ok('the flip within tolerance is confirmed', confirmed.includes(98.5));
  ok('the unshared floor is not confirmed', !confirmed.includes(95));
  eq('exactly two levels are confirmed', confirmed.length, 2);

  // A flip that drifts past the tolerance is a real disagreement, not a match.
  const drifted = { rungs: [flipRung(99.5)] };
  eq('a flip past the tolerance is not confirmed', confirmedByVolume(standard, drifted, spot).length, 0);

  // A strike never confirms a flip at the same price, and the other way round.
  const crossKind = { rungs: [strikeRung(98.5, 'wall')] };
  eq('a strike does not confirm a flip', confirmedByVolume(standard, crossKind, spot).length, 0);

  // No activity ladder confirms nothing.
  eq('a null activity confirms nothing', confirmedByVolume(standard, null, spot).length, 0);
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
