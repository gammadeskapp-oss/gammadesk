/*
 * Validation of the −5…+5 Macro Bias scoring in
 * src/lib/macroBias/rich/compute.ts.
 *
 * As with scripts/verify-macro-bias.mjs, the driver logic is transcribed here
 * rather than imported, so this is an independent check rather than a function
 * tested against itself. Keep the two in sync when either changes.
 *
 * What this exists to catch is an inverted sign — the kind of bug that yields a
 * confident, wrong label rather than an obvious break. Falling rates, a softer
 * dollar, a calm VIX, broad breadth and tightening credit are all tailwinds
 * (+1); their opposites are headwinds (−1). It also checks the −5…+5 clamp and
 * that confidence is independent of direction.
 *
 * Run: node scripts/verify-macro-bias-rich.mjs
 */

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
  checks += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`  FAIL ${label}: expected ${expected}, got ${actual}`);
  } else {
    console.log(`  ok   ${label} = ${actual}`);
  }
}

// --- transcribed scorers (signs only) --------------------------------------

const lastTwo = (s) => [s[s.length - 2] ?? s[s.length - 1], s[s.length - 1]];

function scoreRates(series, flatPp) {
  const [prior, latest] = lastTwo(series);
  const d = latest.value - prior.value;
  if (Math.abs(d) < flatPp) return 0;
  return d < 0 ? 1 : -1;
}

function scoreDollar(series, flatPct) {
  const [prior, latest] = lastTwo(series);
  const pct = ((latest.value - prior.value) / prior.value) * 100;
  if (Math.abs(pct) < flatPct) return 0;
  return pct < 0 ? 1 : -1;
}

function scoreVol(series, calm, stress) {
  const v = series[series.length - 1].value;
  if (v < calm) return 1;
  if (v > stress) return -1;
  return 0;
}

function scoreCredit(series, flatPp) {
  const [prior, latest] = lastTwo(series);
  const d = latest.value - prior.value;
  if (Math.abs(d) < flatPp) return 0;
  return d < 0 ? 1 : -1;
}

function scoreBreadth(pct) {
  if (pct === null) return 0;
  if (pct > 55) return 1;
  if (pct < 45) return -1;
  return 0;
}

function scoreEvent(label) {
  return label ? -1 : 0;
}

function clampScore(raw) {
  return Math.max(-5, Math.min(5, raw));
}

function confidence(scores, score) {
  const sign = Math.sign(score);
  if (sign === 0) return 30;
  const signed = scores.filter((s) => s !== 0);
  if (signed.length === 0) return 30;
  const agreeing = signed.filter((s) => Math.sign(s) === sign).length;
  return Math.round((agreeing / signed.length) * 100);
}

// --- fixtures ---------------------------------------------------------------

const rising = [{ date: '2026-09-01', value: 4.0 }, { date: '2026-09-02', value: 4.2 }];
const falling = [{ date: '2026-09-01', value: 4.2 }, { date: '2026-09-02', value: 4.0 }];
const flat = [{ date: '2026-09-01', value: 4.0 }, { date: '2026-09-02', value: 4.005 }];

console.log('rates (10Y):');
eq(scoreRates(falling, 0.03), 1, 'falling yield → tailwind');
eq(scoreRates(rising, 0.03), -1, 'rising yield → headwind');
eq(scoreRates(flat, 0.03), 0, 'flat yield → neutral');

console.log('dollar:');
eq(scoreDollar(falling, 0.1), 1, 'softer dollar → tailwind');
eq(scoreDollar(rising, 0.1), -1, 'firmer dollar → headwind');

console.log('volatility (VIX):');
eq(scoreVol([{ value: 13 }], 16, 20), 1, 'calm VIX → tailwind');
eq(scoreVol([{ value: 25 }], 16, 20), -1, 'stressed VIX → headwind');
eq(scoreVol([{ value: 18 }], 16, 20), 0, 'mid VIX → neutral');

console.log('credit (HY OAS):');
eq(scoreCredit(falling, 0.05), 1, 'tightening spread → tailwind');
eq(scoreCredit(rising, 0.05), -1, 'widening spread → headwind');

console.log('breadth:');
eq(scoreBreadth(62), 1, 'broad breadth → tailwind');
eq(scoreBreadth(40), -1, 'narrow breadth → headwind');
eq(scoreBreadth(null), 0, 'no breadth → neutral');

console.log('event risk:');
eq(scoreEvent('CPI'), -1, 'imminent event → headwind');
eq(scoreEvent(null), 0, 'no imminent event → neutral');

console.log('clamp:');
eq(clampScore(6), 5, 'raw +6 clamps to +5');
eq(clampScore(-6), -5, 'raw −6 clamps to −5');
eq(clampScore(2), 2, 'raw +2 passes through');

console.log('confidence (independent of direction):');
// Five tailwinds, one opposing → 5/6 agree.
eq(confidence([1, 1, 1, 1, 1, -1], clampScore(4)), 83, 'mostly one-sided → high');
// Three each way → net 0 → floor.
eq(confidence([1, 1, 1, -1, -1, -1], 0), 30, 'even split → floor');
// A confident bearish reading is high even though direction is negative.
eq(confidence([-1, -1, -1, -1, 0, 0], -4), 100, 'all-bearish → 100');

console.log('');
if (failures > 0) {
  console.error(`verify-macro-bias-rich: ${failures} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`verify-macro-bias-rich: all ${checks} checks passed`);
