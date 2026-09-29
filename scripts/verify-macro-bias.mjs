/*
 * Validation of the Macro Bias scoring in src/lib/macroBias/compute.ts.
 *
 * As with scripts/verify-netliq.mjs, the logic is transcribed here rather than
 * imported, so this is an independent check rather than a function tested
 * against itself. Keep the two in sync when either changes.
 *
 * What this exists to catch is an inverted sign — the kind of bug that yields a
 * confident, wrong label rather than an obvious break. Falling rates are good
 * for stocks (+1); a hike is bad (−1). Cooling inflation is +1; sticky is −1.
 * Getting any of those backwards would still render a plausible box.
 *
 * The last section fetches the real FRED series and checks the parser and the
 * scores against them. It is skipped, not failed, when there is no network.
 *
 * Run: node scripts/verify-macro-bias.mjs
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

const DAY_MS = 86_400_000;

function asOf(series, date) {
  let found = null;
  for (const o of series) {
    if (o.date > date) break;
    found = o;
  }
  return found;
}

// --- transcribed scorers ---------------------------------------------------

function scoreFed(series, lookbackDays) {
  const latest = series[series.length - 1];
  const priorDate = new Date(Date.parse(latest.date) - lookbackDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const prior = asOf(series, priorDate) ?? series[0];
  const delta = latest.value - prior.value;
  if (delta < 0) return 1;
  if (delta > 0) return -1;
  return 0;
}

function scoreTenYear(series, flatPp) {
  const latest = series[series.length - 1];
  const prior = series[series.length - 2] ?? latest;
  const delta = latest.value - prior.value;
  if (Math.abs(delta) < flatPp) return 0;
  return delta < 0 ? 1 : -1;
}

function yoy(series, monthsBack) {
  if (series.length <= monthsBack) return null;
  const latest = series[series.length - 1];
  const past = series[series.length - 1 - monthsBack];
  if (!past || !(past.value > 0)) return null;
  return (latest.value / past.value - 1) * 100;
}

function scoreCpi(series, flatPp) {
  const nowYoy = yoy(series, 12);
  const priorYoy = yoy(series.slice(0, -1), 12);
  if (nowYoy === null || priorYoy === null) return 0;
  const delta = nowYoy - priorYoy;
  if (Math.abs(delta) < flatPp) return 0;
  return delta < 0 ? 1 : -1;
}

function labelFor(score) {
  if (score >= 2) return 'Bullish';
  if (score === 1) return 'Mild up';
  if (score === 0) return 'Flat';
  if (score === -1) return 'Mild down';
  return 'Bearish';
}

// --- synthetic cases -------------------------------------------------------

console.log('Fed factor');
// Steady: same value throughout.
eq(scoreFed([{ date: '2026-06-01', value: 4 }, { date: '2026-09-29', value: 4 }], 90), 0, 'steady');
// Hiking: 3.75 -> 4.00 over the window.
eq(
  scoreFed([{ date: '2026-06-01', value: 3.75 }, { date: '2026-09-29', value: 4 }], 90),
  -1,
  'hiking → −1',
);
// Cutting: 5.00 -> 4.50.
eq(
  scoreFed([{ date: '2026-06-01', value: 5 }, { date: '2026-09-29', value: 4.5 }], 90),
  1,
  'cutting → +1',
);

console.log('10Y factor');
eq(scoreTenYear([{ date: 'a', value: 5.18 }, { date: 'b', value: 5.17 }], 0.03), 0, 'tiny move flat');
eq(scoreTenYear([{ date: 'a', value: 5.2 }, { date: 'b', value: 5.05 }], 0.03), 1, 'falling → +1');
eq(scoreTenYear([{ date: 'a', value: 5.0 }, { date: 'b', value: 5.2 }], 0.03), -1, 'rising → −1');

console.log('CPI factor');
// 12 obs back needed. Build a rising-YoY series (sticky).
const stickyCpi = [];
for (let i = 0; i < 14; i += 1) stickyCpi.push({ date: `m${i}`, value: 300 + i * 3 });
// YoY accelerates because the step is constant on a growing base? Check sign via delta.
eq(scoreCpi(stickyCpi, 0.1), 1, 'linear index → decelerating YoY → cooling +1');

console.log('CPI history window');
// The scorer needs the current YoY (needs >=13 obs) AND the prior month's YoY
// (needs >=14 obs). Too-short a FRED window silently drops the prior-month
// compare to null. Assert those boundaries so the fetch window can't regress.
const cpi13 = [];
for (let i = 0; i < 13; i += 1) cpi13.push({ date: `m${i}`, value: 300 + i });
eq(yoy(cpi13, 12) !== null, true, '13 obs → current YoY available');
eq(yoy(cpi13.slice(0, -1), 12) === null, true, '13 obs → prior-month YoY NULL (the bug)');
const cpi14 = [];
for (let i = 0; i < 14; i += 1) cpi14.push({ date: `m${i}`, value: 300 + i });
eq(yoy(cpi14.slice(0, -1), 12) !== null, true, '14 obs → prior-month YoY available');

console.log('Bias label');
eq(labelFor(-2), 'Bearish', '−2 bearish');
eq(labelFor(-1), 'Mild down', '−1 mild down');
eq(labelFor(0), 'Flat', '0 flat');
eq(labelFor(1), 'Mild up', '+1 mild up');
eq(labelFor(3), 'Bullish', '+3 bullish');

// --- live section ----------------------------------------------------------

async function fetchCsv(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const text = await res.text();
  const out = [];
  for (const line of text.split('\n').slice(1)) {
    const [date, raw] = line.trim().split(',');
    if (!date || !raw || raw === '.') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ date, value });
  }
  return out;
}

console.log('Live FRED (skipped without network)');
try {
  const [fed, ten, cpi] = await Promise.all([
    fetchCsv('DFEDTARU'),
    fetchCsv('DGS10'),
    fetchCsv('CPIAUCSL'),
  ]);
  const fedS = scoreFed(fed, 90);
  const tenS = scoreTenYear(ten, 0.03);
  const cpiS = scoreCpi(cpi, 0.1);
  const total = fedS + tenS + cpiS;
  console.log(
    `  live scores: Fed ${fedS}, 10Y ${tenS}, CPI ${cpiS} → Bias ${total} (${labelFor(total)})`,
  );
  checks += 1;
  if (![fedS, tenS, cpiS].every((s) => s >= -1 && s <= 1)) {
    failures += 1;
    console.error('  FAIL live: a factor score is out of range');
  } else {
    console.log('  ok   live scores in range');
  }
} catch (err) {
  console.log(`  skipped: ${err.message}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures > 0 ? 1 : 0);
