/*
 * Validation of the SPY-vs-RSP breadth check's pure logic.
 *
 * Why this file exists: this reading is rendered on five surfaces and two X
 * posts, all from one shared module, and it makes a plain-English claim a
 * reader acts on ("narrow", "broad", "big stocks carrying it"). The risk is the
 * same one `verify-context.mjs` guards: a verdict that quietly flips its meaning
 * in a later edit, or a stale reading shown as if it were live. So every verdict
 * case is walked, the gap-band edges are pinned, the staleness rule is checked
 * both ways, and the two post/summary lines are held to their exact shape.
 *
 * Run: npm run verify:spy-rsp
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const {
  spyRspVerdict,
  buildSpyRspReading,
  isSpyRspStale,
  spyRspSummaryLine,
  spyRspPostLine,
  GAP_BAND_PCT,
  STALE_AFTER_MINUTES,
  SPY_RSP_VERDICT_LINE,
} = await import('../src/lib/breadth/spyRspCore.ts');

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

// --- the five named verdict cases from the brief -----------------------------

section('Each verdict case reads as specified');

ok('both up, gap in band -> broad-up', spyRspVerdict(0.6, 0.5) === 'broad-up');
ok('SPY up, RSP down -> narrow', spyRspVerdict(0.6, -0.2) === 'narrow');
ok('SPY up, RSP down a lot -> narrow', spyRspVerdict(0.6, -1.4) === 'narrow');
ok('SPY up, gap < -0.3 (RSP up less) -> narrow', spyRspVerdict(0.6, 0.1) === 'narrow');
ok('RSP up more than SPY (gap > +0.3) -> avg-leading', spyRspVerdict(0.2, 0.9) === 'avg-leading');
ok('both down, gap in band -> broad-down', spyRspVerdict(-0.5, -0.4) === 'broad-down');
ok('SPY down, RSP up -> big-lagging', spyRspVerdict(-0.4, 0.3) === 'big-lagging');

// --- the two honest cases outside the five -----------------------------------

section('The cases the brief does not name still read honestly');

ok('both down, RSP worse -> narrow-down (not up-tape narrow)', spyRspVerdict(-0.3, -0.9) === 'narrow-down');
ok('dead flat -> even', spyRspVerdict(0, 0) === 'even');
ok('narrow-down wording is a down-tape line, not "carrying it"',
  SPY_RSP_VERDICT_LINE['narrow-down'].includes('holding the line'));
ok('narrow wording is the up-tape "carrying it"',
  SPY_RSP_VERDICT_LINE['narrow'].includes('carrying it'));

// --- the gap band edges land on the right side -------------------------------

section('Gap-band edges (±0.3 pts)');

ok('gap +0.29 (inside band) is NOT avg-leading', spyRspVerdict(0.1, 0.39) !== 'avg-leading');
ok('gap +0.32 is avg-leading', spyRspVerdict(0.1, 0.42) === 'avg-leading');
ok('GAP_BAND_PCT is 0.3', GAP_BAND_PCT === 0.3);

// --- no direction/advice wording anywhere ------------------------------------

section('No buy/sell or forecast wording in any verdict line');

for (const [key, line] of Object.entries(SPY_RSP_VERDICT_LINE)) {
  ok(`${key} has no advice wording`, !/\b(buy|sell|long|short|target|will|expect)\b/i.test(line), line);
}

// --- staleness: a stale reading is hidden, a closed-market one is kept --------

section('Stale data is hidden, never faked');

const base = buildSpyRspReading({
  spyPct: 0.6, rspPct: -0.2, monthRatioChangePct: -1.3, monthRatioSeries: [1, 0.99], at: '2026-10-06T14:00:00Z',
});
const freshNow = new Date('2026-10-06T14:05:00Z');
const staleNow = new Date('2026-10-06T14:40:00Z');

ok('null reading is stale', isSpyRspStale(null, { marketOpen: true }));
ok('fresh reading while open is not stale', !isSpyRspStale(base, { marketOpen: true, now: freshNow }));
ok(`${STALE_AFTER_MINUTES}+ min old while open is stale`, isSpyRspStale(base, { marketOpen: true, now: staleNow }));
ok('an old reading after the close is kept (it is the day close)', !isSpyRspStale(base, { marketOpen: false, now: staleNow }));

// --- the shared wording lines hold their shape -------------------------------

section('Summary and post lines are exact');

const narrow = buildSpyRspReading({ spyPct: 0.6, rspPct: -0.2, monthRatioChangePct: null, monthRatioSeries: null, at: base.at });
ok('summary line', spyRspSummaryLine(narrow) === 'SPY ▲0.6% · RSP ▼0.2% → Narrow — big stocks carrying it',
  spyRspSummaryLine(narrow));
ok('post line', spyRspPostLine(narrow) === 'Big vs avg stock: SPY ▲ · RSP ▼ (narrow)', spyRspPostLine(narrow));

const broad = buildSpyRspReading({ spyPct: 0.6, rspPct: 0.55, monthRatioChangePct: null, monthRatioSeries: null, at: base.at });
ok('broad post line uses the broad tag', spyRspPostLine(broad).endsWith('(broad)'), spyRspPostLine(broad));

// --- gapPct is derived, not supplied -----------------------------------------

section('The reading derives its own gap');

ok('gapPct = rsp - spy', Math.abs(narrow.gapPct - (-0.2 - 0.6)) < 1e-9, String(narrow.gapPct));
ok('line matches the verdict', narrow.line === SPY_RSP_VERDICT_LINE[narrow.verdict]);

// --- the X morning/closing composers drop the line first ---------------------

section('The SPY-vs-RSP line is the first thing an over-long post drops');

const compose = await import('../src/lib/x/compose.ts');
const srLine = spyRspPostLine(narrow);
const fullSnap = {
  spot: 777.85, changePct: 0.006, dayHigh: 778.9, dayLow: 775.1, mood: 'calm',
  resistance: 785, support: 777, flip: 773.2,
  strong: [{ symbol: 'PLTR', score: 85 }, { symbol: 'MRNA', score: 84 }, { symbol: 'AMD', score: 84 }],
  weak: [{ symbol: 'DIA', score: 44 }, { symbol: 'IWM', score: 56 }],
  gainers: [], losers: [], headline: null, spyRspLine: srLine,
  dataIso: '2026-10-06T14:00:00Z',
};
const shortSnap = { ...fullSnap, flip: null, strong: [{ symbol: 'PLTR', score: 85 }], weak: [] };

ok('morning: the line appears when there is room', compose.composeMorning(shortSnap).text.includes(srLine));
ok('morning: a full post drops the line to stay <=280', !compose.composeMorning(fullSnap).text.includes(srLine));
ok('morning: that full post is within the limit', compose.composeMorning(fullSnap).length <= 280);
ok('closing: the line appears when there is room', compose.composeClosing(shortSnap).text.includes(srLine));
ok('a post with no reading omits the line cleanly',
  !compose.composeMorning({ ...shortSnap, spyRspLine: null }).text.includes('Big vs avg'));

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
