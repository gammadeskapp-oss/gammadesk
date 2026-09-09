/*
 * Validation of the episodic-pivot scan and its pause tracker.
 *
 * Why this file exists: this scanner outputs a ranked list of tickers a reader
 * might act on, and every threshold in it is a claim about the data. The pure
 * scan runs entirely on synthetic bars here, with no network, so each rule can
 * be pinned to a case that exercises exactly one edge:
 *
 *  1. A textbook episodic pivot is found, and the reported gap %, volume ratio,
 *     dollar volume and base range are the numbers the bars actually imply.
 *  2. Each filter drops the case it is meant to and reports the right reason —
 *     short history, liquidity, no gap, not fresh, base not quiet — because the
 *     funnel on the page is built from those reasons and a mislabelled drop is
 *     a lie about why a name is missing.
 *  3. The gap day must close in the top half of its range, or it is not a
 *     pivot; a bottom-half close is rejected however big the gap.
 *  4. Freshness: a second gap inside the prior base removes the name, so the
 *     scanner never surfaces the second leg of a move as if it were the first.
 *  5. The pause tracker: a break of the gap-day midpoint flags a name dead, the
 *     "last five" readings stay null until there are five sessions since the
 *     gap, and tightening is measured off the right window.
 *  6. The display thresholds only ever tighten the captured set.
 *
 * Run: npm run verify:episodic
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { scanSeries, passesDisplay } = await import('../src/lib/episodic/scan.ts');
const {
  EPISODIC_CAPTURE,
  EPISODIC_DEFAULTS,
  MIN_BARS,
  BASE_LOOKBACK,
  GAP_LOOKBACK,
} = await import('../src/lib/episodic/types.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function near(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

/** Sequential fake session dates; the pure scan is index-based, not calendar-based. */
function dateAt(i) {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * A tight base of `count` flat bars around `price`, each a small doji, with a
 * fixed volume. Index-continuous with whatever is pushed after it.
 */
function baseBars({ count, price, vol, wobble = 0.01 }) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const p = price * (1 + (i % 2 === 0 ? wobble : -wobble));
    bars.push({ open: p, high: p * 1.005, low: p * 0.995, close: p, volume: vol });
  }
  return bars;
}

/** Stamp a date on each bar in order. */
function dated(bars) {
  return bars.map((b, i) => ({ ...b, date: dateAt(i) }));
}

/**
 * The canonical qualifying series: a quiet base near $20 on 600k shares, then a
 * +6% gap that closes in the top of its range on 6x volume, then a tightening
 * pause that holds the midpoint.
 */
function textbook({
  pauseCloses = [21.8, 21.9, 21.7, 21.85, 21.75, 21.8, 21.9, 21.7, 21.8, 21.85, 21.8, 21.75, 21.9, 21.8],
  pauseVol = 300_000,
  baseCount = 75,
} = {}) {
  const base = baseBars({ count: baseCount, price: 20, vol: 600_000 }); // indices 0..baseCount-1
  const prevClose = base[base.length - 1].close; // ~20
  const open = prevClose * 1.06; // +6% gap
  const gap = {
    open,
    high: 22.0,
    low: 21.0,
    close: 21.9, // (21.9-21)/(22-21) = 0.9 -> top half
    volume: 3_600_000, // 6x the 600k base average
  };
  const pause = pauseCloses.map((c) => ({
    open: c,
    high: c + 0.15,
    low: c - 0.15,
    close: c,
    volume: pauseVol,
  }));
  return dated([...base, gap, ...pause]);
}

// --- 1. the textbook pivot is found, with correct numbers --------------------
{
  const bars = textbook();
  const res = scanSeries('TEST', 'Test Co', bars, EPISODIC_CAPTURE);
  ok('textbook pivot is a finding', res.kind === 'finding', res.kind === 'drop' ? res.reason : '');

  if (res.kind === 'finding') {
    const f = res.finding;
    ok('gap date is the gap bar', f.gapDate === dateAt(75));
    ok('gap % ~ 6%', near(f.gapPct, 0.06, 1e-3), String(f.gapPct));
    ok('volume ratio ~ 6x', near(f.volumeRatio, 6, 1e-3), String(f.volumeRatio));
    ok('dollar volume = close x shares', near(f.dollarVolume, 21.9 * 3_600_000, 1), String(f.dollarVolume));
    ok('base range within capture', f.baseRangePct <= EPISODIC_CAPTURE.baseRangeMax, String(f.baseRangePct));
    ok('current price is last close', near(f.currentPrice, bars[bars.length - 1].close));
    ok('pct from gap close is signed vs 21.9', near(f.pctFromGapClose, (bars[bars.length - 1].close - 21.9) / 21.9, 1e-9));
    // 14 pause sessions -> tight readings present, held the midpoint.
    ok('sessions since gap = 14', f.pause.sessionsSinceGap === 14, String(f.pause.sessionsSinceGap));
    ok('held above midpoint', f.pause.heldAboveMid === true);
    ok('midpoint = 21.5', near(f.pause.midpoint, 21.5));
    ok('last-5 range present', f.pause.last5RangePct !== null);
    ok('tight-range high present', f.pause.tightRangeHigh !== null);
    ok('vol5vs20 present at 14 sessions', f.pause.vol5vs20 !== null, String(f.pause.vol5vs20));
    // Chart window covers the base through to the end.
    ok('chart bars start a base before the gap', f.bars.length >= BASE_LOOKBACK + 1);
    ok('chart ends on the last session', f.bars[f.bars.length - 1].date === bars[bars.length - 1].date);
  }
}

// --- 2a. short history -------------------------------------------------------
{
  const bars = dated(baseBars({ count: MIN_BARS - 1, price: 20, vol: 600_000 }));
  const res = scanSeries('SHORT', null, bars, EPISODIC_CAPTURE);
  ok('too little history drops short-history', res.kind === 'drop' && res.reason === 'short-history', res.kind);
}

// --- 2b. liquidity: cheap, and thin ------------------------------------------
{
  const cheap = textbook();
  // Rebuild near $2 so the current price is under the $5 floor.
  const scaled = cheap.map((b) => ({
    ...b,
    open: b.open / 10, high: b.high / 10, low: b.low / 10, close: b.close / 10,
  }));
  const res = scanSeries('CHEAP', null, scaled, EPISODIC_CAPTURE);
  ok('sub-$5 price drops liquidity', res.kind === 'drop' && res.reason === 'liquidity', res.kind === 'drop' ? res.reason : res.kind);

  const thin = textbook({ pauseVol: 50_000 });
  // Drop the base volume too so the 50-day average sits under 500k.
  const thinned = thin.map((b, i) => (i < 75 ? { ...b, volume: 100_000 } : b));
  const res2 = scanSeries('THIN', null, thinned, EPISODIC_CAPTURE);
  ok('sub-500k ADV drops liquidity', res2.kind === 'drop' && res2.reason === 'liquidity', res2.kind === 'drop' ? res2.reason : res2.kind);
}

// --- 2c. no gap --------------------------------------------------------------
{
  const flat = dated(baseBars({ count: 95, price: 20, vol: 600_000 }));
  const res = scanSeries('FLAT', null, flat, EPISODIC_CAPTURE);
  ok('a flat series drops no-gap', res.kind === 'drop' && res.reason === 'no-gap', res.kind === 'drop' ? res.reason : res.kind);
}

// --- 3. bottom-half close is not a pivot -------------------------------------
{
  const base = baseBars({ count: 75, price: 20, vol: 600_000 });
  const prevClose = base[base.length - 1].close;
  const gap = { open: prevClose * 1.06, high: 22.0, low: 21.0, close: 21.1, volume: 3_600_000 }; // closes near the low
  const pause = baseBars({ count: 10, price: 21.2, vol: 300_000 });
  const bars = dated([...base, gap, ...pause]);
  const res = scanSeries('WEAK', null, bars, EPISODIC_CAPTURE);
  ok('bottom-half close drops no-gap', res.kind === 'drop' && res.reason === 'no-gap', res.kind === 'drop' ? res.reason : res.kind);
}

// --- 4. not fresh: a prior gap inside the base -------------------------------
{
  const bars = textbook();
  // Inject a +6% gap 30 sessions before the real gap (index 45, inside the base
  // 15..74). Bump that single open; leave everything else.
  bars[45] = { ...bars[45], open: bars[44].close * 1.06 };
  const res = scanSeries('SECOND', null, bars, EPISODIC_CAPTURE);
  ok('a gap inside the base drops not-fresh', res.kind === 'drop' && res.reason === 'not-fresh', res.kind === 'drop' ? res.reason : res.kind);
}

// --- 5a. base not quiet: too wide --------------------------------------------
{
  const base = baseBars({ count: 75, price: 20, vol: 600_000 });
  // Spike one early base bar's HIGH only, so the base range blows past the
  // capture max without creating a gap (open/close stay flat, so freshness is
  // not what removes it).
  base[20] = { ...base[20], high: 30 };
  const prevClose = base[base.length - 1].close;
  const gap = { open: prevClose * 1.06, high: 22.0, low: 21.0, close: 21.9, volume: 3_600_000 };
  const pause = baseBars({ count: 10, price: 21.7, vol: 300_000 });
  const bars = dated([...base, gap, ...pause]);
  const res = scanSeries('WIDE', null, bars, EPISODIC_CAPTURE);
  ok('a wide base drops base-too-wide', res.kind === 'drop' && res.reason === 'base-too-wide', res.kind === 'drop' ? res.reason : res.kind);
}

// --- 5b. base not quiet: volume already rising -------------------------------
{
  const base = baseBars({ count: 75, price: 20, vol: 600_000 });
  // Ramp the late half of the base to 4x the early half.
  for (let i = 45; i < 75; i += 1) base[i] = { ...base[i], volume: 2_400_000 };
  const prevClose = base[base.length - 1].close;
  const gap = { open: prevClose * 1.06, high: 22.0, low: 21.0, close: 21.9, volume: 3_600_000 * 4 };
  const pause = baseBars({ count: 10, price: 21.7, vol: 300_000 });
  const bars = dated([...base, gap, ...pause]);
  const res = scanSeries('RAMP', null, bars, EPISODIC_CAPTURE);
  ok('a rising-volume base drops base-vol-rising', res.kind === 'drop' && res.reason === 'base-vol-rising', res.kind === 'drop' ? res.reason : res.kind);
}

// --- 5b'. base already trending up (a clean rising channel) ------------------
{
  // A base that climbs cleanly from ~19 to ~24 over 75 sessions, then a gap.
  const base = [];
  for (let i = 0; i < 75; i += 1) {
    const p = 19 + (i / 74) * 5 + (i % 2 === 0 ? 0.03 : -0.03); // clean +26% ramp
    base.push({ open: p, high: p * 1.004, low: p * 0.996, close: p, volume: 600_000 });
  }
  const prevClose = base[base.length - 1].close;
  const gap = { open: prevClose * 1.06, high: prevClose * 1.1, low: prevClose * 1.05, close: prevClose * 1.09, volume: 3_600_000 };
  const pause = baseBars({ count: 10, price: prevClose * 1.08, vol: 300_000 });
  const bars = dated([...base, gap, ...pause]);
  const res = scanSeries('TREND', null, bars, EPISODIC_CAPTURE);
  ok('a clean rising base drops base-trending', res.kind === 'drop' && res.reason === 'base-trending', res.kind === 'drop' ? res.reason : res.kind);
}

// --- 5b''. a gap up out of a clean DOWNtrend is kept (a reversal) ------------
{
  const base = [];
  for (let i = 0; i < 75; i += 1) {
    const p = 24 - (i / 74) * 4 + (i % 2 === 0 ? 0.03 : -0.03); // clean -17% fall
    base.push({ open: p, high: p * 1.004, low: p * 0.996, close: p, volume: 600_000 });
  }
  const prevClose = base[base.length - 1].close;
  const gap = { open: prevClose * 1.06, high: prevClose * 1.1, low: prevClose * 1.05, close: prevClose * 1.09, volume: 3_600_000 };
  const pause = baseBars({ count: 10, price: prevClose * 1.08, vol: 300_000 });
  const bars = dated([...base, gap, ...pause]);
  const res = scanSeries('REVERSAL', null, bars, EPISODIC_CAPTURE);
  ok('a gap out of a clean downtrend is kept', res.kind === 'finding', res.kind === 'drop' ? res.reason : res.kind);
}

// --- 5c. dead: a close breaks the gap-day midpoint ---------------------------
{
  const bars = textbook({ pauseCloses: [21.8, 21.9, 21.7, 20.9, 21.0, 21.2, 21.3, 21.4, 21.5] }); // 20.9 < mid 21.5
  const res = scanSeries('DEAD', null, bars, EPISODIC_CAPTURE);
  ok('a name that breaks the midpoint still surfaces', res.kind === 'finding', res.kind === 'drop' ? res.reason : '');
  if (res.kind === 'finding') {
    ok('...and is flagged dead', res.finding.pause.heldAboveMid === false);
  }
}

// --- 5d. the last-five readings are null with too few post-gap sessions ------
{
  // A longer base pushes the gap late, leaving only 3 sessions after it while
  // the series is still long enough to evaluate.
  const bars = textbook({ pauseCloses: [21.8, 21.9, 21.7], baseCount: 82 });
  const res = scanSeries('YOUNG', null, bars, EPISODIC_CAPTURE);
  ok('a young pivot is still a finding', res.kind === 'finding', res.kind === 'drop' ? res.reason : '');
  if (res.kind === 'finding') {
    ok('last-5 range null at 3 sessions', res.finding.pause.last5RangePct === null);
    ok('tight-range high null at 3 sessions', res.finding.pause.tightRangeHigh === null);
    ok('vol5vs20 null at 3 sessions', res.finding.pause.vol5vs20 === null);
    ok('sessions since gap = 3', res.finding.pause.sessionsSinceGap === 3);
  }
}

// --- 6. display thresholds only tighten --------------------------------------
{
  const bars = textbook();
  const res = scanSeries('DISP', null, bars, EPISODIC_CAPTURE);
  if (res.kind === 'finding') {
    const f = res.finding;
    ok('passes at the shipped defaults', passesDisplay(f, EPISODIC_DEFAULTS));
    // A 6x volume ratio should fail a 10x display threshold.
    ok('a tighter volume threshold excludes it', !passesDisplay(f, { ...EPISODIC_DEFAULTS, volumeMult: 10 }));
    // The 6% gap should fail a 10% gap threshold.
    ok('a tighter gap threshold excludes it', !passesDisplay(f, { ...EPISODIC_DEFAULTS, gapMinPct: 0.1 }));
  }
}

// --- sanity: the constants line up -------------------------------------------
ok('GAP_LOOKBACK never reaches the volume window', GAP_LOOKBACK <= 20);
ok('MIN_BARS covers a base plus the lookback', MIN_BARS >= BASE_LOOKBACK + GAP_LOOKBACK);

console.log(`\nepisodic: ${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
