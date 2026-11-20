/*
 * Validation of src/lib/decision/exposureGate.ts — the rule that decides
 * whether the exposure tables are shown, and if not, whether that is a thin
 * chain or the data not having arrived — and of `summariseBook` in
 * src/lib/tasty/gex.ts, which turns the feed's state into the gate's inputs.
 *
 * The bug this guards: SPY on /lab read "Not enough options liquidity" because
 * a failed (403) Cboe lookup was taken as a thin chain. A failed or partial
 * read must never produce the liquidity verdict, and a known-deep product's
 * "thin" reading is a feed failure.
 */
import assert from 'node:assert/strict';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();
const { exposureGate, isKnownLiquid } = await import('../src/lib/decision/exposureGate.ts');
const { summariseBook } = await import('../src/lib/tasty/gex.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const health = (over = {}) => ({
  optionsExpected: 1000,
  optionsComplete: 1000,
  openInterest: 2_000_000,
  volume: 50_000,
  dataAgeMs: 500,
  reconnecting: false,
  loading: false,
  lastReconnectReason: null,
  rerequested: false,
  ...over,
});

const liquidity = (status, openInterest, reliable) => ({
  equity: {},
  options: { status, listed: status === 'assessed', openInterest, exposureReliable: reliable, minOpenInterestForExposure: 10_000 },
  asOfLabel: null,
  notes: [],
});

console.log('exposure gate — /lab (feed)');

check('complete deep SPY book shows, no caveat', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health(), marketOpen: true });
  assert.deepEqual(g, { show: true, caveat: null });
});

check('half-loaded SPY book waits for the feed, never "thin"', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health({ optionsComplete: 400, openInterest: 900, loading: true }), marketOpen: true });
  assert.equal(g.show, false);
  assert.equal(g.reason, 'feed');
  assert.match(g.headline, /Waiting for the feed/);
  assert.match(g.detail, /400 of 1,000/);
});

check('incomplete book while the stream is stalled says reconnecting', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health({ optionsComplete: 0, openInterest: 0, dataAgeMs: 29_000 }), marketOpen: true });
  assert.equal(g.reason, 'feed');
  assert.match(g.headline, /reconnecting/);
});

check('complete book on a stalled stream still shows, with a stale caveat', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health({ dataAgeMs: 29_000 }), marketOpen: true });
  assert.equal(g.show, true);
  assert.match(g.caveat, /stale — no update from the stream for 29s; reconnecting/);
});

check('a quiet stream after hours is not called stale', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health({ dataAgeMs: 600_000 }), marketOpen: false });
  assert.deepEqual(g, { show: true, caveat: null });
});

check('reconnecting with a complete book shows the last figures with a caveat', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health({ reconnecting: true, lastReconnectReason: 'no market data for 35s' }), marketOpen: true });
  assert.equal(g.show, true);
  assert.match(g.caveat, /reconnecting \(no market data for 35s\)/);
});

check('complete but "thin" SPY is a feed failure, not a liquidity verdict', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health({ openInterest: 300 }), marketOpen: true });
  assert.equal(g.reason, 'feed');
  assert.match(g.detail, /feed failure, not a reading/);
});

check('complete and genuinely thin small name is "thin"', () => {
  const g = exposureGate({ symbol: 'ZZZZ', liquidity: null, feed: health({ openInterest: 300 }), marketOpen: true });
  assert.deepEqual(g, { show: false, reason: 'thin' });
});

check('on /lab a failed Cboe lookup is irrelevant — the feed book decides', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: liquidity('unread', null, false), feed: health(), marketOpen: true });
  assert.equal(g.show, true);
});

check('an empty book (no options subscribed yet) waits', () => {
  const g = exposureGate({ symbol: 'SPY', liquidity: null, feed: health({ optionsExpected: 0, optionsComplete: 0, openInterest: 0 }), marketOpen: true });
  assert.equal(g.reason, 'feed');
});

console.log('exposure gate — public pages (tradeability lookup)');

check('no lookup at all is permissive', () => {
  assert.equal(exposureGate({ symbol: 'SPY', liquidity: null }).show, true);
});

check('an unread lookup (403 / timeout) never suppresses', () => {
  assert.equal(exposureGate({ symbol: 'ZZZZ', liquidity: liquidity('unread', null, false) }).show, true);
});

check('an assessed deep chain shows', () => {
  assert.deepEqual(exposureGate({ symbol: 'ZZZZ', liquidity: liquidity('assessed', 50_000, true) }), { show: true, caveat: null });
});

check('an assessed thin chain on an unknown name is "thin"', () => {
  assert.deepEqual(exposureGate({ symbol: 'ZZZZ', liquidity: liquidity('assessed', 300, false) }), { show: false, reason: 'thin' });
});

check('an assessed "thin" SPY is ignored as a failed read', () => {
  const g = exposureGate({ symbol: 'spy', liquidity: liquidity('assessed', 300, false) });
  assert.equal(g.show, true);
  assert.match(g.caveat, /treated as a failed read/);
});

check('known-liquid list covers the index products', () => {
  for (const s of ['SPY', 'QQQ', 'SPX', 'IWM', 'NDX', 'spy ']) assert.equal(isKnownLiquid(s), true, s);
  assert.equal(isKnownLiquid('ZZZZ'), false);
  assert.equal(isKnownLiquid(null), false);
});

console.log('summariseBook');

check('counts a contract complete only with both IV and OI; sums what reported', () => {
  const ref = (sym) => ({ streamerSymbol: sym, type: 'call', strike: 100, expiration: '2099-01-01' });
  const states = new Map([
    ['.A', { receivedAt: 0, summary: { openInterest: 500 }, greeks: { volatility: 0.2 }, trade: { dayVolume: 10 } }],
    ['.B', { receivedAt: 0, summary: { openInterest: 300 } }], // no IV yet
    ['.C', { receivedAt: 0, greeks: { volatility: 0.3 } }], // no OI yet
  ]);
  const book = summariseBook([ref('.A'), ref('.B'), ref('.C'), ref('.D')], states);
  assert.deepEqual(book, { optionsExpected: 4, optionsComplete: 1, openInterest: 800, volume: 10 });
});

console.log(`\nverify:exposure-gate — ${passed} checks passed`);
