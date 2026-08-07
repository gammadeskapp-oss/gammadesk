/*
 * Numerical validation of the indicators in src/lib/ticker/indicators.ts.
 *
 * As with scripts/verify-greeks.js, the formulas are transcribed here rather
 * than imported, so this is an independent check rather than a function tested
 * against itself. Keep the two in sync when either changes.
 *
 * Run: npm run verify:indicators
 */

// ---- transcribed from indicators.ts ---------------------------------------

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const c = closes[i] - closes[i - 1];
    if (c >= 0) gainSum += c; else lossSum -= c;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const c = closes[i] - closes[i - 1];
    const gain = c > 0 ? c : 0, loss = c < 0 ? -c : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(closes, fast, slow, signalPeriod) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? fastEma[i] - slowEma[i] : null);
  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal = new Array(closes.length).fill(null);
  if (firstDefined >= 0) {
    const tail = macdLine.slice(firstDefined);
    const tailSignal = ema(tail, signalPeriod);
    for (let i = 0; i < tailSignal.length; i++) signal[firstDefined + i] = tailSignal[i];
  }
  const histogram = macdLine.map((m, i) =>
    m !== null && signal[i] !== null ? m - signal[i] : null);
  return { macd: macdLine, signal, histogram, fastEma, slowEma };
}

function linearRegression(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += i; sumY += values[i]; }
  const meanX = sumX / n, meanY = sumY / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX, dy = values[i] - meanY;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: meanY - slope * meanX, r2: sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy) };
}

function stdev(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
}

// ---- harness ---------------------------------------------------------------

let checks = 0;
const failures = [];

function ok(name, condition, detail) {
  checks++;
  if (!condition) failures.push(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
}

function close(name, actual, expected, tol) {
  checks++;
  if (!(Math.abs(actual - expected) <= tol)) {
    failures.push(`  FAIL ${name}\n       got ${actual}  expected ${expected}  tol ${tol}`);
  }
}

// --- SMA --------------------------------------------------------------------
{
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s = sma(v, 3);
  ok('sma leading nulls', s.slice(0, 2).every((x) => x === null));
  close('sma[2]', s[2], 2, 1e-12);
  close('sma[9]', s[9], 9, 1e-12);
  ok('sma length matches input', s.length === v.length);

  // Brute force every position against a direct mean.
  let worst = 0;
  for (let i = 2; i < v.length; i++) {
    const mean = (v[i] + v[i - 1] + v[i - 2]) / 3;
    worst = Math.max(worst, Math.abs(s[i] - mean));
  }
  ok('sma matches brute force', worst < 1e-12, `worst diff ${worst}`);

  // Rolling-sum implementations drift on long series; check that it does not.
  const long = Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7) * 100 + 500);
  const ls = sma(long, 50);
  let driftWorst = 0;
  for (let i = 4900; i < long.length; i++) {
    const window = long.slice(i - 49, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / 50;
    driftWorst = Math.max(driftWorst, Math.abs(ls[i] - mean));
  }
  ok('sma has no rolling-sum drift over 5000 points', driftWorst < 1e-9, `worst ${driftWorst}`);
}

// --- EMA --------------------------------------------------------------------
{
  const v = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29,
             22.15, 22.39, 22.38, 22.61, 23.36, 24.05, 23.75, 23.83, 23.95, 23.63];
  const e = ema(v, 10);
  ok('ema leading nulls', e.slice(0, 9).every((x) => x === null));

  // Seed is the simple average of the first 10.
  const seed = v.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  close('ema seed == sma of first period', e[9], seed, 1e-12);

  // Recompute forward independently.
  const k = 2 / 11;
  let prev = seed, worst = 0;
  for (let i = 10; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    worst = Math.max(worst, Math.abs(e[i] - prev));
  }
  ok('ema matches independent recursion', worst < 1e-12, `worst ${worst}`);

  // A constant series must return that constant everywhere it is defined.
  const flat = ema(new Array(50).fill(7), 10);
  ok('ema of a constant series is constant', flat.slice(9).every((x) => Math.abs(x - 7) < 1e-12));
}

// --- RSI: Wilder's canonical dataset ----------------------------------------
{
  const prices = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
    45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
    46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
    43.42, 42.66, 43.13,
  ];
  const r = rsi(prices, 14);
  ok('rsi leading nulls', r.slice(0, 14).every((x) => x === null));

  /*
   * First RSI, worked through by hand from the 14 changes:
   *   gains  0.06 0.72 0.50 0.27 0.32 0.42 0.24 0.14 0.67 0.00 = 3.34
   *   losses 0.25 0.54 0.19 0.42                               = 1.40
   *   avgGain 3.34/14 = 0.2385714…, avgLoss 1.40/14 = 0.1
   *   RS = 2.3857142…, RSI = 100 - 100/(1+RS) = 70.4641350…
   *
   * Widely-reproduced tables of this series quote 70.53, which comes from
   * rounding the intermediate averages to two decimals before dividing. The
   * unrounded value is the correct one.
   */
  close('rsi[14] against hand calculation', r[14], 70.46413502109705, 1e-9);

  // Independent cross-check: Wilder's smoothing is an EMA with alpha = 1/n.
  // Computing it that way, through a separate code path, must agree exactly.
  const gains = [];
  const losses = [];
  for (let i = 1; i < prices.length; i++) {
    const c = prices[i] - prices[i - 1];
    gains.push(Math.max(0, c));
    losses.push(Math.max(0, -c));
  }
  const wilder = (series, period) => {
    const out = [];
    let acc = series.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = acc;
    for (let i = period; i < series.length; i++) {
      acc = acc + (series[i] - acc) / period; // alpha = 1/period
      out[i] = acc;
    }
    return out;
  };
  const ag = wilder(gains, 14);
  const al = wilder(losses, 14);

  let worst = 0;
  for (let i = 13; i < gains.length; i++) {
    const expected = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
    worst = Math.max(worst, Math.abs(r[i + 1] - expected));
  }
  ok('rsi matches an independent alpha=1/n EMA formulation', worst < 1e-9,
    `worst diff ${worst}`);

  // Sanity on shape: this series peaks early and falls away at the end.
  ok('rsi peaks in the rising section', r[17] > r[32]);
  ok('rsi values are plausible', r.slice(14).every((x) => x > 25 && x < 80));
}

// --- RSI edge cases ---------------------------------------------------------
{
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 40 }, (_, i) => 100 - i);
  const r1 = rsi(rising, 14);
  const r2 = rsi(falling, 14);
  close('rsi of a monotonic rise is 100', r1[39], 100, 1e-9);
  close('rsi of a monotonic fall is 0', r2[39], 0, 1e-9);

  const all = rsi(
    Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 10),
    14,
  ).filter((x) => x !== null);
  ok('rsi always within [0,100]', all.every((x) => x >= 0 && x <= 100));
}

// --- MACD -------------------------------------------------------------------
{
  const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 9) * 12 + i * 0.15);
  const m = macd(closes, 12, 26, 9);

  // The MACD line is exactly the difference of the two EMAs.
  let worst = 0;
  for (let i = 0; i < closes.length; i++) {
    if (m.macd[i] === null) continue;
    worst = Math.max(worst, Math.abs(m.macd[i] - (m.fastEma[i] - m.slowEma[i])));
  }
  ok('macd == fastEMA - slowEMA', worst < 1e-12, `worst ${worst}`);

  ok('macd undefined before slow period', m.macd.slice(0, 25).every((x) => x === null));
  ok('macd defined at slow period', m.macd[25] !== null);

  // The signal line is an EMA of the MACD line, so it must start exactly 8
  // bars after the MACD line does (period 9 needs 9 values).
  const firstMacd = m.macd.findIndex((x) => x !== null);
  const firstSignal = m.signal.findIndex((x) => x !== null);
  ok('signal starts 8 bars after macd', firstSignal - firstMacd === 8,
    `macd@${firstMacd} signal@${firstSignal}`);

  // Histogram identity.
  let hWorst = 0;
  for (let i = 0; i < closes.length; i++) {
    if (m.histogram[i] === null) continue;
    hWorst = Math.max(hWorst, Math.abs(m.histogram[i] - (m.macd[i] - m.signal[i])));
  }
  ok('histogram == macd - signal', hWorst < 1e-12, `worst ${hWorst}`);

  // Signal line seeded on the MACD tail must equal an EMA computed directly.
  const tail = m.macd.slice(firstMacd);
  const direct = ema(tail, 9);
  let sWorst = 0;
  for (let i = 0; i < direct.length; i++) {
    if (direct[i] === null) continue;
    sWorst = Math.max(sWorst, Math.abs(m.signal[firstMacd + i] - direct[i]));
  }
  ok('signal alignment maps back correctly', sWorst < 1e-12, `worst ${sWorst}`);
}

// --- Linear regression ------------------------------------------------------
{
  // A perfect line must recover its slope exactly with R^2 = 1.
  const line = Array.from({ length: 60 }, (_, i) => 3 + 0.25 * i);
  const r = linearRegression(line);
  close('regression slope on a perfect line', r.slope, 0.25, 1e-12);
  close('regression intercept on a perfect line', r.intercept, 3, 1e-10);
  close('regression r2 on a perfect line', r.r2, 1, 1e-12);

  // A flat line has zero slope and, having no variance to explain, r2 = 0.
  const flat = linearRegression(new Array(40).fill(5));
  close('regression slope on a flat line', flat.slope, 0, 1e-12);
  close('regression r2 on a flat line', flat.r2, 0, 1e-12);

  // A downward line gives a negative slope and still explains everything.
  const down = linearRegression(Array.from({ length: 50 }, (_, i) => 100 - 0.4 * i));
  close('regression slope on a falling line', down.slope, -0.4, 1e-12);
  close('regression r2 on a falling line', down.r2, 1, 1e-12);

  // Pure noise should explain almost nothing.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const noise = Array.from({ length: 400 }, () => rand());
  ok('regression r2 on noise is low', linearRegression(noise).r2 < 0.1,
    `r2 = ${linearRegression(noise).r2}`);

  // R^2 must be invariant to a constant offset and to positive scaling.
  const base = Array.from({ length: 80 }, (_, i) => Math.sin(i / 5) + i * 0.03);
  const shifted = base.map((v) => v + 1000);
  const scaled = base.map((v) => v * 7);
  close('r2 invariant to offset', linearRegression(shifted).r2, linearRegression(base).r2, 1e-10);
  close('r2 invariant to scale', linearRegression(scaled).r2, linearRegression(base).r2, 1e-10);
  close('slope scales linearly', linearRegression(scaled).slope, linearRegression(base).slope * 7, 1e-10);
}

// --- stdev ------------------------------------------------------------------
{
  // Sample standard deviation (n-1), not population.
  const v = [2, 4, 4, 4, 5, 5, 7, 9];
  close('stdev is the sample form (n-1)', stdev(v), 2.13809, 1e-4);
  close('stdev of a constant series is 0', stdev([3, 3, 3, 3]), 0, 1e-12);
  ok('stdev of a single value is 0', stdev([5]) === 0);
}

// ---- report ----------------------------------------------------------------
failures.forEach((f) => console.log(f));
console.log(
  `${checks - failures.length}/${checks} checks passed` +
  (failures.length === 0 ? '  — ALL GREEN' : `  — ${failures.length} FAILURES`),
);
process.exit(failures.length === 0 ? 0 : 1);
