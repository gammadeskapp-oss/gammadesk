/*
 * Validation of the one expired-contract rule (src/lib/time.ts) and the places
 * that lean on it: `buildPositioning` (every table, flip and wall) and the flow
 * filter.
 *
 * The rule: a contract is live until 16:00 New York on its expiration date.
 * Anything dated before today is gone, 0DTE survives the session, and it drops
 * at the close so the next expiration leads. Clock instants below are written
 * in UTC with their New York time beside them; 2026-11-01 is the DST change.
 *
 * Run: npm run verify:expiry
 */
import assert from 'node:assert/strict';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();
const { isExpired, dropExpired, nextCloseMs, closedSince } = await import('../src/lib/time.ts');
const { buildPositioning } = await import('../src/lib/exposure.ts');
const { filterFlow } = await import('../src/lib/flow/filter.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const at = (iso) => new Date(iso);
const MORNING = at('2026-10-28T14:00:00Z'); // Wed 10:00 ET
const LAST_SECOND = at('2026-10-28T19:59:59Z'); // Wed 15:59:59 ET
const CLOSE = at('2026-10-28T20:00:00Z'); // Wed 16:00 ET
const EVENING = at('2026-10-28T22:00:00Z'); // Wed 18:00 ET

console.log('rule');
check('yesterday is expired at any hour today', () => {
  assert.equal(isExpired('2026-10-27', MORNING), true);
  assert.equal(isExpired('2026-10-27', at('2026-10-28T04:30:00Z')), true); // 00:30 ET
});
check('0DTE is live through the session', () => {
  assert.equal(isExpired('2026-10-28', MORNING), false);
  assert.equal(isExpired('2026-10-28', LAST_SECOND), false);
});
check('0DTE drops at the 16:00 ET close', () => {
  assert.equal(isExpired('2026-10-28', CLOSE), true);
  assert.equal(isExpired('2026-10-28', EVENING), true);
});
check('the New York date, not UTC: 21:00 ET is still the 28th, and 0DTE is gone', () => {
  // 01:00Z on the 29th is 21:00 ET on the 28th.
  assert.equal(isExpired('2026-10-28', at('2026-10-29T01:00:00Z')), true);
  assert.equal(isExpired('2026-10-29', at('2026-10-29T01:00:00Z')), false);
});
check('malformed dates count as expired', () => {
  assert.equal(isExpired('', MORNING), true);
  assert.equal(isExpired('not-a-date', MORNING), true);
});
check('dropExpired keeps order and only live rows', () => {
  const rows = ['2026-10-27', '2026-10-28', '2026-10-29'].map((expiration) => ({ expiration }));
  assert.deepEqual(dropExpired(rows, MORNING).map((r) => r.expiration), ['2026-10-28', '2026-10-29']);
  assert.deepEqual(dropExpired(rows, EVENING).map((r) => r.expiration), ['2026-10-29']);
});

console.log('closes');
check('next close is today at 16:00 during the session', () => {
  assert.equal(nextCloseMs(MORNING), CLOSE.getTime());
});
check('next close after Friday skips the weekend and the DST change', () => {
  // Fri Oct 30 16:30 EDT → Mon Nov 2 16:00 EST = 21:00Z.
  assert.equal(nextCloseMs(at('2026-10-30T20:30:00Z')), Date.parse('2026-11-02T21:00:00Z'));
});
check('closedSince: built before a close that has passed → stale', () => {
  assert.equal(closedSince('2026-10-28T19:58:00Z', at('2026-10-28T20:01:00Z')), true);
  assert.equal(closedSince('2026-10-30T19:55:00Z', at('2026-10-31T15:00:00Z')), true); // Fri → Sat
});
check('closedSince: built after the close → good until the next one', () => {
  assert.equal(closedSince('2026-10-28T20:05:00Z', EVENING), false);
  assert.equal(closedSince('2026-10-30T20:05:00Z', at('2026-11-01T18:00:00Z')), false); // Fri → Sun
  assert.equal(closedSince('2026-10-30T20:05:00Z', at('2026-11-02T21:00:00Z')), true); // → Mon close
});
check('closedSince: an unreadable build time is stale', () => {
  assert.equal(closedSince('garbage', MORNING), true);
});

console.log('positioning');
const contract = (expiration, type, strike, oi) => ({
  ticker: `${expiration}${type}${strike}`,
  type,
  strike,
  expiration,
  openInterest: oi,
  volume: 0,
  iv: 0.2,
  ivSource: 'quoted',
  T: 0.01,
});
const book = [
  contract('2026-10-27', 'call', 100, 50_000), // expired yesterday: must never count
  contract('2026-10-27', 'put', 95, 50_000),
  contract('2026-10-28', 'call', 101, 1000),
  contract('2026-10-28', 'put', 99, 1000),
  contract('2026-10-29', 'call', 102, 800),
  contract('2026-10-29', 'put', 98, 800),
];
const build = (now) =>
  buildPositioning(book, {
    spot: 100,
    riskFreeRate: 0,
    dividendYield: 0,
    symbol: 'XYZ',
    expirationCount: 2,
    strikesEachSide: 10,
    now,
    meta: {
      source: 'cboe',
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
    },
  });
check('during the session: 0DTE leads, yesterday is absent', () => {
  const b = build(MORNING);
  assert.deepEqual(b.expirations, ['2026-10-28', '2026-10-29']);
  assert.ok(!b.rows.some((r) => r.strike === 100 || r.strike === 95), 'expired strikes have no row');
});
check('after the close: 0DTE is gone and the next expiration leads', () => {
  const b = build(EVENING);
  assert.equal(b.expirations[0], '2026-10-29');
  assert.ok(!b.expirations.includes('2026-10-28'));
  assert.ok(!b.rows.some((r) => [100, 95, 101, 99].includes(r.strike)));
});
check('expired open interest never reaches a wall', () => {
  const b = build(MORNING);
  // The 50k-OI expired strikes would dominate both magnets if they leaked in.
  assert.notEqual(b.summary.magnetAbove?.strike, 100);
  assert.notEqual(b.summary.magnetBelow?.strike, 95);
  assert.equal(b.meta.contractsUsed, 4);
});

console.log('flow');
const flowRow = (expiration) => ({ expiration, symbol: 'SPY' });
const snapshot = {
  rows: [flowRow('2020-01-17'), flowRow('2099-01-16')],
  symbols: [{ symbol: 'SPY', flagged: 2 }],
};
check('default view drops expired rows', () => {
  const f = filterFlow(snapshot);
  assert.deepEqual(f.rows.map((r) => r.expiration), ['2099-01-16']);
  assert.equal(f.expiredHidden, 1);
});
check('an explicit range reaching backwards still shows no expired row', () => {
  const f = filterFlow(snapshot, { from: '2019-01-01', to: '2100-01-01' });
  assert.deepEqual(f.rows.map((r) => r.expiration), ['2099-01-16']);
});

console.log(`\n${passed} checks passed`);
