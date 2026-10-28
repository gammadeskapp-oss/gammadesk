/*
 * Validation of the /lab Tastytrade path: src/lib/tasty/gex.ts (feed events →
 * the public model's contracts), src/lib/tasty/mock.ts (the mock feed) and
 * src/lib/lab/auth.ts (the lock).
 *
 * The point of the gex section: /lab has no GEX formula of its own. Its book is
 * the public `buildPositioning` run on contracts read off the feed, so a strike
 * on /lab must equal `contractMetrics` from lib/exposure.ts on the same inputs,
 * and a hand-worked value of the public formula (dealer sign, × S² × 1%).
 *
 * The modules are imported and are the subject — Node 22.6+ strips the types.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();
const { feedContracts, spotFrom } = await import('../src/lib/tasty/gex.ts');
const { mockSnapshot, streamerSymbol } = await import('../src/lib/tasty/mock.ts');
const { buildPositioning, contractMetrics } = await import('../src/lib/exposure.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const META = {
  source: 'tastytrade',
  sourceLabel: 'test',
  asOfLabel: '',
  asOfIso: '',
  quoteDateLabel: '',
  quoteDateIso: '',
  cacheSeconds: 0,
  upstreamRequests: 0,
  riskFreeRate: 0,
  dividendYield: 0,
  notes: [],
};

/* ---------- hand fixture ----------
 * spot = 100 (bid 99.9 / ask 100.1), one expiry exactly 8 days out (both dates in EDT), r = q = 0.
 *   95 put  IV 0.25, OI 1000
 *  100 call IV 0.20, OI  500, volume 120
 *  100 put  IV 0.20, OI  300
 *  105 call IV 0.18, OI 2000
 *  110 call — no Summary yet: skipped, not zeroed
 *  115 call — no IV: skipped
 * The Greeks event's own `gamma` is a deliberately wrong 0.05 on every leg: the
 * public model prices gamma from IV, so that field must not reach the numbers.
 */
const NOW = new Date('2026-10-22T20:00:00Z'); // 16:00 ET
const EXPIRY = '2026-10-30';
function fixture() {
  const states = new Map();
  states.set('XYZ', {
    quote: { eventType: 'Quote', eventSymbol: 'XYZ', bidPrice: 99.9, askPrice: 100.1, bidSize: 1, askSize: 1, time: 1 },
    receivedAt: 1,
  });
  const legs = [
    ['.XYZP95', 'put', 95, 0.25, 1000, undefined],
    ['.XYZC100', 'call', 100, 0.2, 500, 120],
    ['.XYZP100', 'put', 100, 0.2, 300, undefined],
    ['.XYZC105', 'call', 105, 0.18, 2000, undefined],
    ['.XYZC110', 'call', 110, 0.17, undefined, undefined],
    ['.XYZC115', 'call', 115, Number.NaN, 400, undefined],
  ];
  const options = [];
  for (const [sym, type, strike, iv, oi, vol] of legs) {
    options.push({ streamerSymbol: sym, type, strike, expiration: EXPIRY });
    const st = {
      greeks: { eventType: 'Greeks', eventSymbol: sym, gamma: 0.05, volatility: iv, price: 0, delta: 0, theta: 0, rho: 0, vega: 0, time: 1 },
      receivedAt: 1,
    };
    if (oi !== undefined) st.summary = { eventType: 'Summary', eventSymbol: sym, openInterest: oi };
    if (vol !== undefined) st.trade = { eventType: 'Trade', eventSymbol: sym, price: 1, size: 1, dayVolume: vol, time: 1 };
    states.set(sym, st);
  }
  return { underlying: 'XYZ', options, states };
}

/** The public GEX formula written out: sign · OI · 100 · Γ(BS) · S² · 0.01, r = q = 0. */
function handGex(type, K, iv, oi, S, T) {
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
  const gamma = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) / (S * iv * Math.sqrt(T));
  return (type === 'call' ? 1 : -1) * oi * 100 * gamma * S * S * 0.01;
}

const snap = fixture();
const spot = spotFrom(snap.states.get('XYZ'));
const contracts = feedContracts(snap, NOW);
const params = { spot, riskFreeRate: 0, dividendYield: 0 };
const book = buildPositioning(contracts, {
  ...params,
  symbol: 'XYZ',
  expirationCount: 6,
  strikesEachSide: 20,
  meta: META,
});

console.log('gex');
check('spot is the quote mid', () => assert.equal(spot, 100));
check('contracts missing OI or IV are skipped, not zeroed', () => {
  assert.equal(contracts.length, 4);
  assert.deepEqual(
    contracts.map((c) => c.strike).sort((a, b) => a - b),
    [95, 100, 100, 105],
  );
});
check('feed IV / OI / volume carried as-is; T on the public clock', () => {
  const c = contracts.find((x) => x.ticker === '.XYZC100');
  assert.equal(c.iv, 0.2);
  assert.equal(c.openInterest, 500);
  assert.equal(c.volume, 120);
  assert.equal(c.ivSource, 'quoted');
  assert.ok(close(c.T, 8 / 365, 1e-12));
  assert.equal(contracts.find((x) => x.ticker === '.XYZP100').volume, 0);
});
check('each strike = public contractMetrics on the same contracts', () => {
  for (const row of book.rows) {
    const expected = contracts
      .filter((c) => c.strike === row.strike)
      .reduce((sum, c) => sum + contractMetrics(c, params).gex, 0);
    assert.ok(close(row.total.gex, expected), `strike ${row.strike}`);
  }
});
check('each strike = the public formula by hand (dealer sign, per 1%)', () => {
  const T = 8 / 365;
  const by = Object.fromEntries(book.rows.map((r) => [r.strike, r.total.gex]));
  assert.ok(close(by[95], handGex('put', 95, 0.25, 1000, 100, T), 1e-6));
  assert.ok(close(by[100], handGex('call', 100, 0.2, 500, 100, T) + handGex('put', 100, 0.2, 300, 100, T), 1e-6));
  assert.ok(close(by[105], handGex('call', 105, 0.18, 2000, 100, T), 1e-6));
  assert.ok(by[95] < 0, 'puts carry the negative dealer sign');
});
check('net GEX, regime and magnets come from the public summary', () => {
  const sum = book.rows.reduce((s, r) => s + r.total.gex, 0);
  assert.ok(close(book.summary.netGex, sum));
  assert.equal(book.summary.regime, sum >= 0 ? 'positive' : 'negative');
  assert.equal(book.summary.magnetAbove.strike, 105);
  assert.equal(book.summary.magnetBelow.strike, 95);
});
check('spot falls back to the last trade, then null', () => {
  assert.equal(spotFrom({ trade: { price: 42 }, receivedAt: 0 }), 42);
  assert.equal(spotFrom({ quote: { bidPrice: Number.NaN, askPrice: 1 }, receivedAt: 0 }), null);
  assert.equal(spotFrom(undefined), null);
});
check('expired contracts are dropped', () => {
  assert.equal(feedContracts(fixture(), new Date('2026-10-31T12:00:00Z')).length, 0);
});

console.log('mock');
const now = Date.parse('2026-10-22T15:00:00Z');
const mock = mockSnapshot('SPY', now);
const mockSpot = spotFrom(mock.states.get('SPY'));
const mockContracts = feedContracts(mock, new Date(now));
const mockBook = (weightBy) =>
  buildPositioning(mockContracts, {
    spot: mockSpot,
    riskFreeRate: 0.04,
    dividendYield: 0.013,
    symbol: 'SPY',
    expirationCount: 6,
    strikesEachSide: 20,
    weightBy,
    meta: META,
  });
check('every mock contract carries IV and OI', () => assert.equal(mockContracts.length, mock.options.length));
check('mock spot sits near the anchor', () => assert.ok(Math.abs(mockSpot - 672) / 672 < 0.005));
check('mock is reproducible for the same instant', () => {
  assert.deepEqual(feedContracts(mockSnapshot('SPY', now), new Date(now)), mockContracts);
});
check('mock book has a flip and magnets through the public builder', () => {
  const b = mockBook('openInterest');
  assert.ok(b.rows.length > 0);
  assert.ok(b.summary.flipLevel !== null && Number.isFinite(b.summary.flipLevel));
  assert.ok(b.summary.magnetAbove || b.summary.magnetBelow);
});
check('mock options carry volume, so the activity pass builds', () => {
  assert.ok(mockContracts.some((c) => c.volume > 0));
  assert.ok(mockBook('volume').rows.length > 0);
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
  const s = spotFrom(mockSnapshot('ZZZQ', now, 37.5).states.get('ZZZQ'));
  assert.ok(Math.abs(s - 37.5) / 37.5 < 0.005);
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
