/*
 * Validation of the /lab put/call flow math: src/lib/tasty/flow.ts.
 *
 * - recordTrade: dayVolume differencing, at-trade delta, pending volume settled
 *   by a later Greeks event, day roll-over, first-sight "late" weighting.
 * - computeFlow: hand-worked delta-weighted vs volume ratios, the ±5% band,
 *   far-dated and thin expirations dropped from the headline only, OI ratio,
 *   the minimum-volume guard, the shared lean thresholds.
 * - The mock feed: delta-weighted and volume ratios differ (the weighting is
 *   actually applied) and the near-money ratio lands in a sane range.
 */
import assert from 'node:assert/strict';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();
const flow = await import('../src/lib/tasty/flow.ts');
const { mockSnapshot } = await import('../src/lib/tasty/mock.ts');
const { recordTrade, contractFlow, computeFlow, flowLean, FLOW_LEAN, MIN_SCOPE_VOLUME } = flow;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

console.log('recordTrade');
check('first sight is pre-watch volume: base, nothing live yet', () => {
  const t = recordTrade(undefined, 1000, -0.4, 10);
  assert.deepEqual(t, { dayVolume: 1000, baseVolume: 1000, watchedSince: 10, liveDeltaVolume: 0, pending: 0 });
});
check('later increments are weighted at the delta held when they printed', () => {
  let t = recordTrade(undefined, 1000, 0.5, 0);
  t = recordTrade(t, 1300, 0.6, 1); // +300 @ 0.6
  t = recordTrade(t, 1300, 0.9, 2); // no change
  t = recordTrade(t, 1400, -0.2, 3); // +100 @ |−0.2|
  assert.ok(close(t.liveDeltaVolume, 180 + 20));
  assert.equal(t.baseVolume, 1000);
  assert.equal(t.dayVolume, 1400);
});
check('volume with no delta yet is pending, weighted at the next delta', () => {
  let t = recordTrade(undefined, 200, null, 0);
  t = recordTrade(t, 260, null, 1);
  assert.equal(t.pending, 60);
  t = recordTrade(t, 260, 0.5, 2); // the Greeks-event path: same dayVolume, delta now known
  assert.equal(t.pending, 0);
  assert.ok(close(t.liveDeltaVolume, 30));
});
check('dayVolume going down (new session) restarts the tally', () => {
  let t = recordTrade(undefined, 5000, 0.5, 0);
  t = recordTrade(t, 5200, 0.5, 1);
  t = recordTrade(t, 40, 0.25, 99);
  assert.deepEqual(t, { dayVolume: 40, baseVolume: 40, watchedSince: 99, liveDeltaVolume: 0, pending: 0 });
});
check('NaN / negative dayVolume is ignored', () => {
  const t = recordTrade(undefined, 100, 0.5, 0);
  assert.equal(recordTrade(t, Number.NaN, 0.5, 1), t);
  assert.equal(recordTrade(undefined, -1, 0.5, 1), undefined);
});
check('contractFlow: live at at-trade delta, pre-watch at current delta (late)', () => {
  let t = recordTrade(undefined, 1000, -0.2, 5);
  t = recordTrade(t, 1500, -0.3, 6); // +500 @ 0.3 = 150
  const f = contractFlow(t, -0.9); // the put has since gone in the money
  assert.equal(f.liveVolume, 500);
  assert.ok(close(f.liveDeltaVolume, 150));
  assert.ok(close(f.lateDeltaVolume, 900)); // 1000 pre-watch × 0.9 — the bias the live window avoids
  assert.ok(close(f.sessionDeltaVolume, 1050));
  assert.equal(f.watchedSince, 5);
});

console.log('computeFlow');
const NOW = new Date('2026-11-19T16:00:00Z'); // 11:00 ET Thursday
const SPOT = 700;
// Every fixture contract watched since t=100 from zero, so live == session.
const c = (type, strike, expiration, volume, delta, oi = 0) => ({
  type,
  strike,
  expiration,
  volume,
  sessionDeltaVolume: Math.abs(delta) * volume,
  lateDeltaVolume: 0,
  liveVolume: volume,
  liveDeltaVolume: Math.abs(delta) * volume,
  watchedSince: 100,
  openInterest: oi,
});
const book = [
  // near money, front week — the headline
  c('call', 700, '2026-11-20', 4000, 0.5, 10_000),
  c('call', 720, '2026-11-20', 6000, 0.1, 20_000),
  c('put', 690, '2026-11-20', 3000, -0.35, 30_000),
  c('put', 670, '2026-11-20', 9000, -0.05, 40_000),
  // near money but far-dated (>45d): out of the headline
  c('put', 700, '2027-06-17', 800, -0.45, 5_000),
  // near money, inside 45d, but thin (<1%): out of the headline
  c('put', 700, '2026-12-31', 50, -0.5, 1_000),
  // outside ±5%: out of the headline
  c('put', 600, '2026-11-20', 20_000, -0.01, 90_000),
  // expired yesterday: dropped everywhere
  c('put', 700, '2026-11-18', 99_999, -0.5, 99_999),
];
const r = computeFlow(book, SPOT, NOW);
check('band is ±5% of spot', () => {
  assert.ok(close(r.band.low, 665) && close(r.band.high, 735));
});
check('headline delta-weighted ratio, hand-worked', () => {
  // puts: 3000×0.35 + 9000×0.05 = 1050 + 450 = 1500; calls: 4000×0.5 + 6000×0.1 = 2600
  assert.ok(close(r.near.live.putDeltaVolume, 1500));
  assert.ok(close(r.near.live.callDeltaVolume, 2600));
  assert.ok(close(r.near.live.deltaRatio, 1500 / 2600));
  assert.equal(r.near.live.sinceMs, 100);
});
check('headline volume ratio differs from the weighted one', () => {
  // puts 12000 / calls 10000 = 1.2 (bearish) vs 0.577 weighted (bullish)
  assert.ok(close(r.near.session.volumeRatio, 1.2));
  assert.equal(r.near.session.volumeLean, 'bearish');
  assert.equal(r.near.live.deltaLean, 'bullish');
});
check('far-dated and thin expirations listed and kept out of the headline', () => {
  assert.deepEqual(
    r.excluded.map((e) => [e.expiration, e.reason]),
    [
      ['2026-12-31', 'thin'],
      ['2027-06-17', 'far-dated'],
    ],
  );
  assert.deepEqual(r.near.expirations, ['2026-11-20']);
});
check('wide scope includes everything passed in, unexpired', () => {
  assert.equal(r.wide.contracts, 7);
  assert.equal(r.wide.session.putVolume, 3000 + 9000 + 800 + 50 + 20000);
  assert.ok(close(r.wide.session.putDeltaVolume, 1500 + 360 + 25 + 200));
});
check('OI ratio is put OI ÷ call OI per scope', () => {
  assert.ok(close(r.near.oiRatio, 70_000 / 30_000));
  assert.ok(close(r.wide.oiRatio, (30_000 + 40_000 + 5_000 + 1_000 + 90_000) / 30_000));
});
check('too little volume in scope prints no ratio', () => {
  const thin = computeFlow([c('call', 700, '2026-11-20', 100, 0.5), c('put', 700, '2026-11-20', 100, -0.5)], SPOT, NOW);
  assert.ok(200 < MIN_SCOPE_VOLUME);
  assert.equal(thin.near.live.deltaRatio, null);
  assert.equal(thin.near.session.volumeRatio, null);
  assert.match(thin.near.live.note, /Only 200 contracts/);
});
check('session keeps pre-watch volume at current delta and says how much', () => {
  const pre = { ...c('put', 700, '2026-11-20', 2000, -0.9), liveVolume: 0, liveDeltaVolume: 0, lateDeltaVolume: 1800 };
  const x = computeFlow([pre, c('call', 700, '2026-11-20', 2000, 0.5)], SPOT, NOW);
  assert.ok(close(x.near.session.lateShare, 1800 / 2800));
  assert.ok(close(x.near.session.deltaRatio, 1.8));
  assert.ok(close(x.near.live.callVolume, 2000));
  assert.equal(x.near.live.putVolume, 0);
});
check('lean thresholds: ≤0.6 bullish, 0.6–1.0 neutral, ≥1.0 bearish', () => {
  assert.equal(FLOW_LEAN.bullishMax, 0.6);
  assert.equal(FLOW_LEAN.bearishMin, 1.0);
  assert.equal(flowLean(0.6), 'bullish');
  assert.equal(flowLean(0.61), 'neutral');
  assert.equal(flowLean(0.99), 'neutral');
  assert.equal(flowLean(1.0), 'bearish');
  assert.equal(flowLean(null), null);
});

console.log('mock feed');
check('mock: weighting applied, near-money ratio sane', () => {
  const now = Date.parse('2026-11-19T16:00:00Z');
  const snap = mockSnapshot('SPY', now, 700);
  const contracts = snap.options.map((ref) => {
    const s = snap.states.get(ref.streamerSymbol);
    const v = s.trade.dayVolume;
    const d = Math.abs(s.greeks.delta) * v;
    return { type: ref.type, strike: ref.strike, expiration: ref.expiration, volume: v, sessionDeltaVolume: d, lateDeltaVolume: 0, liveVolume: v, liveDeltaVolume: d, watchedSince: now, openInterest: s.summary.openInterest };
  });
  const m = computeFlow(contracts, 700, new Date(now));
  const atm = snap.options.filter((o) => Math.abs(o.strike - 700) <= 2);
  assert.ok(atm.every((o) => Math.abs(snap.states.get(o.streamerSymbol).greeks.delta) > 0.05), 'mock ATM deltas set');
  assert.ok(m.near.live.deltaRatio > 0.3 && m.near.live.deltaRatio < 2, `near Δ ratio ${m.near.live.deltaRatio}`);
  assert.ok(Math.abs(m.near.live.deltaRatio - m.near.live.volumeRatio) > 0.01, 'weighted ≠ volume');
});

console.log(`\n${passed} checks passed`);
