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
  settleSpyRspVerdict,
  applySpyRspHysteresis,
  isSpyRspStale,
  spyRspSummaryLine,
  spyRspPostLine,
  GAP_BAND_PCT,
  QUIET_BAND_PCT,
  BROAD_BAND_PCT,
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

// --- the four worked examples from the brief ---------------------------------

section('The brief\'s four worked examples read exactly as specified');

ok('SPY -0.1 / RSP 0.0 -> quiet', spyRspVerdict(-0.1, 0.0) === 'quiet');
ok('  ... its line is "Quiet day, no clear difference"',
  SPY_RSP_VERDICT_LINE[spyRspVerdict(-0.1, 0.0)] === 'Quiet day, no clear difference');
ok('SPY -0.8 / RSP -0.7 -> broad-down (Broad selling)', spyRspVerdict(-0.8, -0.7) === 'broad-down');
ok('  ... its line is "Broad selling"',
  SPY_RSP_VERDICT_LINE[spyRspVerdict(-0.8, -0.7)] === 'Broad selling');
ok('SPY +0.6 / RSP -0.2 -> narrow (big stocks carrying it)', spyRspVerdict(0.6, -0.2) === 'narrow');
ok('  ... its line carries the "carrying it" wording',
  SPY_RSP_VERDICT_LINE[spyRspVerdict(0.6, -0.2)].includes('carrying it'));
ok('SPY -0.6 / RSP +0.1 -> big-lagging (rest holding up)', spyRspVerdict(-0.6, 0.1) === 'big-lagging');
ok('  ... its line is "Big stocks lagging, the rest holding up"',
  SPY_RSP_VERDICT_LINE[spyRspVerdict(-0.6, 0.1)] === 'Big stocks lagging, the rest holding up');

// --- rule 1: broad only when BOTH legs are beyond ±0.5% ----------------------

section('Rule 1 — "broad" needs both legs beyond ±0.5%');

ok('both clearly up -> broad-up', spyRspVerdict(0.6, 0.7) === 'broad-up');
ok('both clearly down -> broad-down', spyRspVerdict(-0.6, -0.7) === 'broad-down');
ok('only one leg past 0.5 (0.6/0.45) is NOT broad', spyRspVerdict(0.6, 0.45) === 'mixed');
ok('both exactly at +0.5 (not beyond) is NOT broad', spyRspVerdict(0.5, 0.5) !== 'broad-up');
ok('BROAD_BAND_PCT is 0.5', BROAD_BAND_PCT === 0.5);

// --- rule 2: quiet when BOTH legs are within ±0.3% ---------------------------

section('Rule 2 — "quiet" when both legs are within ±0.3%');

ok('both tiny negative (-0.1/-0.0x) -> quiet, not broad selling', spyRspVerdict(-0.1, -0.04) === 'quiet');
ok('both at the +0.3 edge, no gap -> still quiet', spyRspVerdict(0.3, 0.3) === 'quiet');
ok('one leg just past 0.3 -> no longer quiet', spyRspVerdict(0.1, 0.35) !== 'quiet');
ok('both zero -> quiet', spyRspVerdict(0, 0) === 'quiet');
ok('QUIET_BAND_PCT is 0.3', QUIET_BAND_PCT === 0.3);

// --- rule 3: gap verdicts only when the gap exceeds 0.3% ----------------------

section('Rule 3 — gap verdicts only when |gap| > 0.3%');

ok('gap +0.29 (inside band) is NOT avg-leading', spyRspVerdict(0.1, 0.39) !== 'avg-leading');
ok('gap +0.32 is avg-leading', spyRspVerdict(0.1, 0.42) === 'avg-leading');
ok('gap -0.5 on an up tape -> narrow', spyRspVerdict(0.6, 0.1) === 'narrow');
ok('gap -0.6 on a down tape -> narrow-down', spyRspVerdict(-0.3, -0.9) === 'narrow-down');
ok('GAP_BAND_PCT is 0.3', GAP_BAND_PCT === 0.3);

// --- rule 4: everything else is a mixed day ----------------------------------

section('Rule 4 — in between is a "mixed" day');

ok('one leg out, no gap, not broad -> mixed', spyRspVerdict(-0.45, -0.4) === 'mixed');
ok('mixed wording is "Mixed day"', SPY_RSP_VERDICT_LINE['mixed'] === 'Mixed day');
ok('narrow-down wording is a down-tape line, not "carrying it"',
  SPY_RSP_VERDICT_LINE['narrow-down'].includes('holding the line'));

// --- rule 5: a verdict only changes after holding for two refreshes -----------

section('Rule 5 — anti-flicker: a change holds for two refreshes before showing');

ok('first reading of the day adopts its verdict at once',
  settleSpyRspVerdict(null, 'broad-down').verdict === 'broad-down');
ok('an unchanged verdict stays put', settleSpyRspVerdict({ verdict: 'quiet', pendingVerdict: null }, 'quiet').verdict === 'quiet');

// refresh 1: raw flips quiet -> broad-down. Keep showing quiet, remember candidate.
const flip1 = settleSpyRspVerdict({ verdict: 'quiet', pendingVerdict: null }, 'broad-down');
ok('a new verdict does NOT show on its first refresh', flip1.verdict === 'quiet');
ok('the new verdict is recorded as pending', flip1.pendingVerdict === 'broad-down');

// refresh 2: raw still broad-down, matching the pending candidate -> switch.
const flip2 = settleSpyRspVerdict(flip1, 'broad-down');
ok('the new verdict shows once it has held twice in a row', flip2.verdict === 'broad-down');
ok('pending clears after the switch', flip2.pendingVerdict === null);

// a candidate that does not repeat is replaced, not shown.
const jitter = settleSpyRspVerdict(flip1, 'mixed');
ok('a one-off different reading does not flip the shown verdict', jitter.verdict === 'quiet');
ok('the newest candidate replaces the stale one', jitter.pendingVerdict === 'mixed');

// applySpyRspHysteresis settles the whole reading, keeping the raw verdict.
const prevReading = buildSpyRspReading({ spyPct: -0.1, rspPct: 0.0, monthRatioChangePct: null, monthRatioSeries: null, at: '2026-10-06T14:00:00Z' });
const rawNext = buildSpyRspReading({ spyPct: -0.8, rspPct: -0.7, monthRatioChangePct: null, monthRatioSeries: null, at: '2026-10-06T14:01:00Z' });
const settledNext = applySpyRspHysteresis(prevReading, rawNext);
ok('settled reading keeps showing the prior verdict on the first flip', settledNext.verdict === 'quiet');
ok('settled reading records the raw verdict for the health view', settledNext.rawVerdict === 'broad-down');
ok('settled reading line matches its shown verdict', settledNext.line === SPY_RSP_VERDICT_LINE['quiet']);

// --- rule 6: never render "-0.0%" --------------------------------------------

section('Rule 6 — a negative-zero reading never prints "-0.0%"');

const negZero = buildSpyRspReading({ spyPct: -0.04, rspPct: -0.02, monthRatioChangePct: null, monthRatioSeries: null, at: '2026-10-06T14:00:00Z' });
ok('summary line shows 0.0%, never -0.0%', !spyRspSummaryLine(negZero).includes('-0.0'), spyRspSummaryLine(negZero));
ok('both legs round to 0.0% here', spyRspSummaryLine(negZero).includes('SPY ▬0.0%') && spyRspSummaryLine(negZero).includes('RSP ▬0.0%'), spyRspSummaryLine(negZero));

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
