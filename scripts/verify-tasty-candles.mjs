/*
 * Validation of /lab's live candles: src/lib/tasty/candleBook.ts, the pure
 * half that turns dxFeed `Candle` events (HISTORY contract, newest-first with
 * snapshot flags) into a chart series. The socket itself is not exercised.
 */
import assert from 'node:assert/strict';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();
const {
  applyCandle,
  candleBars,
  candleSymbolFor,
  emptyCandleBook,
  feedDelay,
  formatDelay,
  FLAG_REMOVE_EVENT,
  FLAG_SNAPSHOT_BEGIN,
  FLAG_SNAPSHOT_END,
  FLAG_SNAPSHOT_SNIP,
} = await import('../src/lib/tasty/candleBook.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 6, 14, 30);
const bar = (i, close, flags = 0, extra = {}) => ({
  eventSymbol: 'SPY{=5m,tho=true}',
  eventFlags: flags,
  time: T0 + i * 5 * MIN,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 1000 + i,
  ...extra,
});

check('a newest-first snapshot comes out oldest-first and complete', () => {
  const book = emptyCandleBook();
  applyCandle(book, bar(2, 102, FLAG_SNAPSHOT_BEGIN), 1);
  applyCandle(book, bar(1, 101), 2);
  assert.equal(book.complete, false);
  applyCandle(book, bar(0, 100, FLAG_SNAPSHOT_END), 3);
  assert.equal(book.complete, true);
  assert.deepEqual(candleBars(book, 0).map((b) => b.close), [100, 101, 102]);
  assert.equal(book.lastAt, 3);
});

check('SNAPSHOT_SNIP also ends the snapshot', () => {
  const book = emptyCandleBook();
  applyCandle(book, bar(0, 100, FLAG_SNAPSHOT_BEGIN | FLAG_SNAPSHOT_SNIP), 1);
  assert.equal(book.complete, true);
});

check('the live bar updates in place after the snapshot', () => {
  const book = emptyCandleBook();
  applyCandle(book, bar(1, 101, FLAG_SNAPSHOT_BEGIN), 1);
  applyCandle(book, bar(0, 100, FLAG_SNAPSHOT_END), 2);
  applyCandle(book, bar(1, 103.5), 3);
  const bars = candleBars(book, 0);
  assert.equal(bars.length, 2);
  assert.equal(bars[1].close, 103.5);
});

check('a new snapshot (reconnect) replaces the old series', () => {
  const book = emptyCandleBook();
  applyCandle(book, bar(5, 105, FLAG_SNAPSHOT_BEGIN | FLAG_SNAPSHOT_END), 1);
  applyCandle(book, bar(1, 101, FLAG_SNAPSHOT_BEGIN), 2);
  assert.equal(book.complete, false);
  assert.deepEqual(candleBars(book, 0).map((b) => b.close), [101]);
});

check('REMOVE flag and NaN close delete a bar', () => {
  const book = emptyCandleBook();
  applyCandle(book, bar(1, 101, FLAG_SNAPSHOT_BEGIN), 1);
  applyCandle(book, bar(0, 100, FLAG_SNAPSHOT_END), 2);
  applyCandle(book, bar(1, 101, FLAG_REMOVE_EVENT), 3);
  assert.deepEqual(candleBars(book, 0).map((b) => b.close), [100]);
  applyCandle(book, bar(0, 'NaN'), 4);
  assert.equal(candleBars(book, 0).length, 0);
});

check('an empty-history snapshot ends complete with no bars', () => {
  const book = emptyCandleBook();
  applyCandle(book, { eventSymbol: 'X{=5m}', eventFlags: FLAG_SNAPSHOT_BEGIN | FLAG_SNAPSHOT_END | FLAG_REMOVE_EVENT, time: 'NaN', close: 'NaN' }, 1);
  assert.equal(book.complete, true);
  assert.equal(candleBars(book, 0).length, 0);
});

check('string-encoded numbers and missing OHLV fall back sensibly', () => {
  const book = emptyCandleBook();
  applyCandle(book, { eventSymbol: 'S', eventFlags: 0, time: String(T0), close: '733.5', open: 'NaN', high: undefined, low: null, volume: 'NaN' }, 1);
  const [b] = candleBars(book, 0);
  assert.deepEqual({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }, { o: 733.5, h: 733.5, l: 733.5, c: 733.5, v: 0 });
});

check('fromTime trims older bars', () => {
  const book = emptyCandleBook();
  for (let i = 0; i < 4; i += 1) applyCandle(book, bar(i, 100 + i), i);
  assert.deepEqual(candleBars(book, T0 + 10 * MIN).map((b) => b.close), [102, 103]);
});

check('candle symbols are dxFeed-canonical (dxLink answers {=1m} as {=m})', () => {
  assert.equal(candleSymbolFor('SPY', '1m'), 'SPY{=m,tho=true}');
  assert.equal(candleSymbolFor('SPY', '5m'), 'SPY{=5m,tho=true}');
  assert.equal(candleSymbolFor('SPY', '15m'), 'SPY{=15m,tho=true}');
  assert.equal(candleSymbolFor('QQQ', '1h'), 'QQQ{=h,tho=true}');
  assert.equal(candleSymbolFor('QQQ', '4h'), 'QQQ{=4h,tho=true}');
  assert.equal(candleSymbolFor('SPY', '1D'), 'SPY{=d}');
  for (const tf of ['1m', '5m', '15m', '1h', '4h', '1D']) {
    assert.ok(!/{=1[mhd]/.test(candleSymbolFor('SPY', tf)), `${tf} has a non-canonical period`);
  }
});

check('feed delay: demo level or trades over 2 min old is delayed', () => {
  const now = Date.UTC(2026, 10, 6, 17, 8);
  // As measured on 2026-11-06: level demo, every trade 900 s old.
  assert.deepEqual(feedDelay('demo', now - 900_000, now), { delayMs: 900_000, delayed: true });
  assert.equal(feedDelay('real-time', now - 900_000, now).delayed, true);
  assert.equal(feedDelay('real-time', now - 1_500, now).delayed, false);
  assert.equal(feedDelay('demo', null, now).delayed, true);
  assert.deepEqual(feedDelay(null, undefined, now), { delayMs: null, delayed: false });
  assert.equal(formatDelay(900_000), '15 min');
  assert.equal(formatDelay(45_000), '45 s');
});

console.log(`\n${passed} checks passed`);
