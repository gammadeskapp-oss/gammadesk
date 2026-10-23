/*
 * Validation of the /lab Tastytrade path: src/lib/tasty/gex.ts (the GEX math),
 * src/lib/tasty/mock.ts (the mock feed) and src/lib/lab/auth.ts (the lock).
 *
 * The modules are imported and are the subject — Node 22.6+ strips the types.
 * Expected values for the hand fixture are worked on paper and written down as
 * literals, not read back from the implementation.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const { computeGex, zeroGammaLevel, magnets, spotFrom } = await import('../src/lib/tasty/gex.ts');
const { mockSnapshot, streamerSymbol } = await import('../src/lib/tasty/mock.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

/* ---------- hand fixture ----------
 * spot = 100 (bid 99.9 / ask 100.1).
 *   95 put : gamma 0.02, OI 1000 → 0.02·1000·100·100 = 200,000 (put)
 *  100 call: gamma 0.05, OI  500 → 250,000 (call)
 *  100 put : gamma 0.05, OI  300 → 150,000 (put)
 *  105 call: gamma 0.02, OI 2000 → 400,000 (call)
 * Per strike net: 95 → −200,000 ; 100 → +100,000 ; 105 → +400,000
 * Cumulative:     −200,000 → −100,000 → +300,000
 * Crossing between 100 and 105: 100 + (100,000 / 400,000)·5 = 101.25
 * Totals: call 650,000, put 350,000, net 300,000; max |net| strike 105.
 */
function fixture() {
  const states = new Map();
  states.set('XYZ', { quote: { eventType: 'Quote', eventSymbol: 'XYZ', bidPrice: 99.9, askPrice: 100.1, bidSize: 1, askSize: 1, time: 1 }, receivedAt: 1 });
  const legs = [
    ['.XYZP95', 'put', 95, 0.02, 1000],
    ['.XYZC100', 'call', 100, 0.05, 500],
    ['.XYZP100', 'put', 100, 0.05, 300],
    ['.XYZC105', 'call', 105, 0.02, 2000],
    // A contract with no Summary yet must be skipped, not counted as zero OI.
    ['.XYZC110', 'call', 110, 0.01, undefined],
  ];
  const options = [];
  for (const [sym, type, strike, gamma, oi] of legs) {
    options.push({ streamerSymbol: sym, type, strike, expiration: '2026-11-20' });
    const st = { greeks: { eventType: 'Greeks', eventSymbol: sym, gamma, volatility: 0.2, price: 0, delta: 0, theta: 0, rho: 0, vega: 0, time: 1 }, receivedAt: 1 };
    if (oi !== undefined) st.summary = { eventType: 'Summary', eventSymbol: sym, openInterest: oi };
    states.set(sym, st);
  }
  return { underlying: 'XYZ', options, states };
}

console.log('gex');
const g = computeGex(fixture(), Date.parse('2026-10-22T15:00:00Z'));
check('spot is the quote mid', () => assert.equal(g.spot, 100));
check('call / put / net totals', () => {
  assert.ok(Math.abs(g.callGex - 650_000) < 1e-6);
  assert.ok(Math.abs(g.putGex - 350_000) < 1e-6);
  assert.ok(Math.abs(g.netGex - 300_000) < 1e-6);
});
check('per-strike net = call − put', () => {
  const by = Object.fromEntries(g.strikes.map((r) => [r.strike, r.netGex]));
  assert.ok(Math.abs(by[95] + 200_000) < 1e-6);
  assert.ok(Math.abs(by[100] - 100_000) < 1e-6);
  assert.ok(Math.abs(by[105] - 400_000) < 1e-6);
});
check('zero gamma interpolates the cumulative sign flip', () => assert.ok(Math.abs(g.zeroGamma - 101.25) < 1e-9));
check('max-GEX strike', () => {
  assert.equal(g.maxGexStrike, 105);
  assert.ok(Math.abs(g.maxGex - 400_000) < 1e-6);
});
check('contract without OI is skipped, not zeroed', () => {
  assert.equal(g.contractsUsed, 4);
  assert.equal(g.contractsRequested, 5);
});
check('OI totals', () => {
  assert.equal(g.totalCallOi, 2500);
  assert.equal(g.totalPutOi, 1300);
});
check('magnets either side of spot', () => {
  const m = magnets(g);
  assert.equal(m.above.strike, 105);
  assert.equal(m.below.strike, 95);
});
check('no flip when the cumulative never crosses', () => {
  assert.equal(zeroGammaLevel([{ strike: 1, netGex: 5 }, { strike: 2, netGex: 5 }], 1.5), null);
});
check('spot falls back to the last trade, then null', () => {
  assert.equal(spotFrom({ trade: { price: 42 }, receivedAt: 0 }), 42);
  assert.equal(spotFrom({ quote: { bidPrice: Number.NaN, askPrice: 1 }, receivedAt: 0 }), null);
  assert.equal(spotFrom(undefined), null);
});
check('no underlying quote → no reading', () => {
  const f = fixture();
  f.states.delete('XYZ');
  assert.equal(computeGex(f), null);
});

console.log('mock');
const now = Date.parse('2026-10-22T15:00:00Z');
const mock = mockSnapshot('SPY', now);
const mg = computeGex(mock, now);
check('every mock contract carries gamma and OI', () => assert.equal(mg.contractsUsed, mg.contractsRequested));
check('mock spot sits near the anchor', () => assert.ok(Math.abs(mg.spot - 672) / 672 < 0.005));
check('mock is reproducible for the same instant', () => {
  const again = computeGex(mockSnapshot('SPY', now), now);
  assert.equal(again.netGex, mg.netGex);
});
check('mock has a zero-gamma level and a max-GEX strike', () => {
  assert.ok(mg.zeroGamma !== null && Number.isFinite(mg.zeroGamma));
  assert.ok(mg.maxGexStrike !== null);
});
check('mock events use dxFeed shapes and streamer symbols', () => {
  const ref = mock.options[0];
  const st = mock.states.get(ref.streamerSymbol);
  assert.equal(st.greeks.eventType, 'Greeks');
  assert.equal(st.summary.eventType, 'Summary');
  assert.match(ref.streamerSymbol, /^\.SPY\d{6}[CP]\d+(\.\d+)?$/);
  assert.equal(streamerSymbol('SPY', '2026-10-23', 'call', 672.5), '.SPY261023C672.5');
});
check('reference price anchors an unknown symbol', () => {
  const r = computeGex(mockSnapshot('ZZZQ', now, 37.5), now);
  assert.ok(Math.abs(r.spot - 37.5) / 37.5 < 0.005);
});

console.log('auth');
const auth = await import('../src/lib/lab/auth.ts');
const stored = auth.hashLabPassword('correct horse', randomBytes(16));
process.env.LAB_PASSWORD_HASH = stored;
delete process.env.LAB_SESSION_SECRET;
check('right password passes, wrong ones fail', () => {
  assert.equal(auth.checkLabPassword('correct horse'), true);
  assert.equal(auth.checkLabPassword('correct horsE'), false);
  assert.equal(auth.checkLabPassword(''), false);
  assert.equal(auth.checkLabPassword(undefined), false);
});
check('a session verifies, a tampered or expired one does not', () => {
  const t0 = Date.now();
  const token = auth.createLabSession(t0);
  assert.equal(auth.verifyLabSession(token, t0 + 1000), true);
  assert.equal(auth.verifyLabSession(token, t0 + auth.LAB_SESSION_TTL_MS + 1), false);
  const [exp, mac] = token.split('.');
  assert.equal(auth.verifyLabSession(`${Number(exp) + 1}.${mac}`, t0), false);
  assert.equal(auth.verifyLabSession(`${exp}.${mac.slice(0, -2)}AA`, t0), false);
  assert.equal(auth.verifyLabSession(undefined, t0), false);
});
check('rotating the hash invalidates sessions', () => {
  const token = auth.createLabSession();
  process.env.LAB_PASSWORD_HASH = auth.hashLabPassword('another', randomBytes(16));
  assert.equal(auth.verifyLabSession(token), false);
  process.env.LAB_PASSWORD_HASH = stored;
});
check('no hash configured → locked', () => {
  delete process.env.LAB_PASSWORD_HASH;
  assert.equal(auth.labPasswordConfigured(), false);
  assert.equal(auth.checkLabPassword('correct horse'), false);
  assert.equal(auth.createLabSession(), null);
  process.env.LAB_PASSWORD_HASH = 'scrypt$garbage';
  assert.equal(auth.checkLabPassword('correct horse'), false);
});

console.log(`\n${passed} checks passed`);
