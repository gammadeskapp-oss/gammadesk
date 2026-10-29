/*
 * Validation of the exposure tables' Signal column (src/lib/strikeSignal.ts):
 * GEX, VEX and CEX vote by sign, tiny values abstain, open interest only tags.
 *
 * Run: npm run verify:signal
 */
import assert from 'node:assert/strict';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const s = await import('../src/lib/strikeSignal.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const total = (gex, vex, cex, callOi = 100, putOi = 100) => ({
  gex, vex, cex, oi: callOi - putOi, callGex: 0, putGex: 0, callOi, putOi,
});
const row = (strike, ...args) => ({ strike, cells: [], total: total(...args) });

check('classify: every vote pattern lands where the table says', () => {
  const c = (...v) => s.classify(v);
  assert.deepEqual(c(1, 1, 1), { label: 'Confirmed', direction: 1 });
  assert.deepEqual(c(-1, -1, -1), { label: 'Confirmed', direction: -1 });
  assert.deepEqual(c(1, 1, 0), { label: 'Aligned', direction: 1 });
  assert.deepEqual(c(-1, 0, -1), { label: 'Aligned', direction: -1 });
  assert.deepEqual(c(1, 1, -1), { label: 'Aligned', direction: 1 });
  assert.deepEqual(c(1, -1, 0), { label: 'Conflict', direction: 0 });
  assert.deepEqual(c(1, 0, 0), { label: 'Mixed', direction: 0 });
  assert.deepEqual(c(0, -1, 0), { label: 'Mixed', direction: 0 });
  assert.deepEqual(c(0, 0, 0), { label: 'Mixed', direction: 0 });
});

check('vote: under 2% of the column max abstains; NaN and empty columns abstain', () => {
  assert.equal(s.vote(1.9, 100), 0);
  assert.equal(s.vote(-2, 100), -1);
  assert.equal(s.vote(5, 100), 1);
  assert.equal(s.vote(Number.NaN, 100), 0);
  assert.equal(s.vote(5, 0), 0);
});

check('strikeSignals: thresholds are per metric, so units never mix', () => {
  // VEX in the billions, CEX in the thousands: each judged against its own column.
  const sig = s.strikeSignals([
    row(100, 1e6, 2e9, 5e3),
    row(105, 1e6, 1e7, -5e3), // VEX is 0.5% of its column max → abstains
    row(110, -1e6, -2e9, -5e3),
  ]);
  assert.equal(sig.get(100).label, 'Confirmed');
  assert.equal(sig.get(100).direction, 1);
  assert.deepEqual(sig.get(105).votes, { gex: 1, vex: 0, cex: -1 });
  assert.equal(sig.get(105).label, 'Conflict');
  assert.equal(sig.get(110).label, 'Confirmed');
  assert.equal(sig.get(110).direction, -1);
});

check('OI never votes: the same greeks read the same label at any OI', () => {
  const sig = s.strikeSignals([row(1, 5, 5, 5, 1, 1), row(2, 5, 5, 5, 1e6, 1e6), row(3, 5, -5, 0, 0, 0)]);
  assert.equal(sig.get(1).label, 'Confirmed');
  assert.equal(sig.get(2).label, 'Confirmed');
  assert.equal(sig.get(3).label, 'Conflict');
});

check('OI tag: gross OI ranked, top quarter strong, bottom quarter thin, zero always thin', () => {
  // Gross OI 0, 10, 20, ..., 80 across nine strikes. Net OI is zero on several
  // of them; gross is what ranks.
  const rows = Array.from({ length: 9 }, (_, i) => row(100 + i, 1, 1, 1, i * 5, i * 5));
  const sig = s.strikeSignals(rows);
  const tags = rows.map((r) => sig.get(r.strike).oiTag);
  assert.deepEqual(tags, ['thin', 'thin', 'thin', '', '', '', 'strong', 'strong', 'strong']);
  assert.equal(sig.get(108).grossOi, 80);
});

check('OI tag: a table of equal strikes tags none of them', () => {
  const sig = s.strikeSignals([row(1, 1, 1, 1), row(2, 1, 1, 1), row(3, 1, 1, 1)]);
  assert.deepEqual([...sig.values()].map((x) => x.oiTag), ['', '', '']);
});

check('text: label, then the tag only when there is one', () => {
  const sig = s.strikeSignals(Array.from({ length: 5 }, (_, i) => row(i, 1, 1, i === 2 ? -1 : 1, i * 10, 0)));
  assert.equal(s.signalText(sig.get(4)), 'Confirmed · strong');
  assert.equal(s.signalText(sig.get(2)), 'Aligned');
  assert.equal(s.signalText(sig.get(0)), 'Confirmed · thin');
  assert.equal(s.signalDetail(sig.get(2), String), 'GEX + · VEX + · CEX −\nGross OI 20 (calls + puts)');
});

console.log(`\n${passed} checks passed`);
