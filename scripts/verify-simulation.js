/*
 * Statistical validation of the Monte Carlo in src/lib/forecast/simulate.ts.
 *
 * As with the other harnesses, the code under test is transcribed rather than
 * imported, so this checks the algorithm independently. Keep them in sync.
 *
 * Run: npm run verify:simulation
 */

const MAX_BEND_SIGMA = 0.3;
const TRADING_DAYS = 252;

function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGaussian(random) {
  let spare = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    const u = Math.max(random(), Number.EPSILON);
    const v = random();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

function magnetBend(price, expiry, kernelWidth) {
  if (!expiry || kernelWidth <= 0) return 0;
  let force = 0, capacity = 0;
  const PEAK = Math.exp(-0.5);
  for (const { strike, weight } of expiry.strikes) {
    const u = (strike - price) / kernelWidth;
    if (u > 4 || u < -4) continue;
    force += weight * u * Math.exp(-0.5 * u * u);
    capacity += Math.abs(weight) * PEAK;
  }
  if (capacity === 0) return 0;
  const n = force / capacity;
  return Math.max(-MAX_BEND_SIGMA, Math.min(MAX_BEND_SIGMA, n * MAX_BEND_SIGMA));
}

function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function simulate({ spot, volatility, annualDrift, horizon, paths, magnets, crashThreshold, seed }) {
  const random = makeRandom(seed ?? 0x5eed1234);
  const gaussian = makeGaussian(random);
  const dailySigma = volatility / Math.sqrt(TRADING_DAYS);
  const dailyDrift = annualDrift / TRADING_DAYS;
  const kernelWidth = Math.max(spot * 0.0015, spot * dailySigma);

  const expiryByDay = [];
  for (let d = 1; d <= horizon; d++) {
    expiryByDay.push(magnets.find((e) => e.tradingDay >= d) ?? null);
  }

  const prices = Array.from({ length: horizon }, () => new Array(paths));
  let crashes = 0, bendSamples = 0, bendCapped = 0;

  for (let p = 0; p < paths; p++) {
    let price = spot, crashed = false;
    const crashLevel = spot * (1 - crashThreshold);
    for (let d = 1; d <= horizon; d++) {
      const bend = magnetBend(price, expiryByDay[d - 1], kernelWidth);
      bendSamples++;
      if (Math.abs(bend) >= MAX_BEND_SIGMA - 1e-9) bendCapped++;
      const shock = gaussian() + bend;
      price *= Math.exp(dailyDrift - 0.5 * dailySigma * dailySigma + dailySigma * shock);
      if (!crashed && price <= crashLevel) crashed = true;
      prices[d - 1][p] = price;
    }
    if (crashed) crashes++;
  }

  const bands = [];
  for (let d = 1; d <= horizon; d++) {
    const s = prices[d - 1].slice().sort((a, b) => a - b);
    bands.push({
      day: d,
      p2_5: percentile(s, 0.025), p16: percentile(s, 0.16), p50: percentile(s, 0.5),
      p84: percentile(s, 0.84), p97_5: percentile(s, 0.975),
    });
  }

  const finals = prices[horizon - 1];
  const higher = finals.filter((v) => v > spot).length;

  return {
    bands, crashPct: (crashes / paths) * 100,
    higherPct: (higher / paths) * 100,
    bendSaturation: (bendCapped / bendSamples) * 100,
    finals,
  };
}

// ---- harness ---------------------------------------------------------------
let checks = 0;
const failures = [];
const ok = (name, cond, detail) => {
  checks++;
  if (!cond) failures.push(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
};
const near = (name, actual, expected, tol) => {
  checks++;
  if (!(Math.abs(actual - expected) <= tol)) {
    failures.push(`  FAIL ${name}\n       got ${actual}  expected ${expected} +/- ${tol}`);
  }
};

// --- the random number generator -------------------------------------------
{
  const g = makeGaussian(makeRandom(42));
  const n = 400000;
  const xs = new Array(n);
  for (let i = 0; i < n; i++) xs[i] = g();

  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const varr = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(varr);
  const skew = xs.reduce((a, x) => a + ((x - mean) / sd) ** 3, 0) / n;
  const kurt = xs.reduce((a, x) => a + ((x - mean) / sd) ** 4, 0) / n;

  near('gaussian mean is 0', mean, 0, 0.01);
  near('gaussian sd is 1', sd, 1, 0.01);
  near('gaussian skew is 0', skew, 0, 0.03);
  near('gaussian kurtosis is 3', kurt, 3, 0.06);

  // Tail masses, which is what the confidence bands actually depend on.
  const within1 = xs.filter((x) => Math.abs(x) <= 1).length / n;
  const within2 = xs.filter((x) => Math.abs(x) <= 1.959964).length / n;
  near('68% of draws within 1 sd', within1, 0.6827, 0.005);
  near('95% of draws within 1.96 sd', within2, 0.95, 0.005);

  // Determinism: same seed, same stream.
  const a = makeGaussian(makeRandom(7));
  const b = makeGaussian(makeRandom(7));
  let identical = true;
  for (let i = 0; i < 1000; i++) if (a() !== b()) { identical = false; break; }
  ok('same seed reproduces the same path', identical);
}

// --- magnet bend ------------------------------------------------------------
{
  const attract = { tradingDay: 5, strikes: [{ strike: 100, weight: 1 }] };
  const repel = { tradingDay: 5, strikes: [{ strike: 100, weight: -1 }] };
  const width = 1;

  // An attractor above pulls up; below pulls down.
  ok('attractor above pulls up', magnetBend(99, attract, width) > 0);
  ok('attractor below pulls down', magnetBend(101, attract, width) < 0);
  // A repeller does the opposite.
  ok('repeller above pushes down', magnetBend(99, repel, width) < 0);
  ok('repeller below pushes up', magnetBend(101, repel, width) > 0);

  // At the strike itself there is no gradient, so no pull either way.
  near('no pull exactly at the strike', magnetBend(100, attract, width), 0, 1e-12);

  // Distant strikes must not reach across the board.
  near('no pull far from the strike', magnetBend(140, attract, width), 0, 1e-9);

  // The cap holds everywhere, for any field.
  let worst = 0;
  const field = {
    tradingDay: 5,
    strikes: [
      { strike: 95, weight: -1 }, { strike: 98, weight: 0.6 },
      { strike: 100, weight: 1 }, { strike: 103, weight: -0.8 },
      { strike: 107, weight: 0.4 },
    ],
  };
  for (let price = 80; price <= 120; price += 0.05) {
    worst = Math.max(worst, Math.abs(magnetBend(price, field, width)));
  }
  ok(`bend never exceeds ${MAX_BEND_SIGMA} sigma`, worst <= MAX_BEND_SIGMA + 1e-12,
    `worst ${worst}`);

  // A single dominant strike should be able to reach the cap.
  let peak = 0;
  for (let price = 90; price <= 110; price += 0.01) {
    peak = Math.max(peak, Math.abs(magnetBend(price, attract, width)));
  }
  near('a lone strike saturates the cap at its peak', peak, MAX_BEND_SIGMA, 1e-6);

  ok('no magnets means no bend', magnetBend(100, null, width) === 0);
  ok('empty strike list means no bend', magnetBend(100, { strikes: [] }, width) === 0);
}

// --- simulation against log-normal theory ------------------------------------
{
  const spot = 500, vol = 0.20, horizon = 20, paths = 40000;
  const out = simulate({
    spot, volatility: vol, annualDrift: 0, horizon, paths,
    magnets: [], crashThreshold: 0.08, seed: 99,
  });

  const dailySigma = vol / Math.sqrt(TRADING_DAYS);
  const sT = dailySigma * Math.sqrt(horizon);
  const last = out.bands[horizon - 1];

  // With zero drift the median is spot * exp(-0.5 * sigma^2 * T).
  const theoryMedian = spot * Math.exp(-0.5 * dailySigma * dailySigma * horizon);
  near('median matches log-normal theory', last.p50, theoryMedian, spot * 0.004);

  // Band ratios follow from the normal quantiles.
  near('p84/median == exp(sigma*sqrt(T))', last.p84 / last.p50, Math.exp(sT), 0.006);
  near('p16/median == exp(-sigma*sqrt(T))', last.p16 / last.p50, Math.exp(-sT), 0.006);
  near('p97.5/median == exp(1.96*sigma*sqrt(T))', last.p97_5 / last.p50,
    Math.exp(1.959964 * sT), 0.02);

  // Ordering must hold on every single day.
  let ordered = true;
  for (const b of out.bands) {
    if (!(b.p2_5 <= b.p16 && b.p16 <= b.p50 && b.p50 <= b.p84 && b.p84 <= b.p97_5)) {
      ordered = false; break;
    }
  }
  ok('percentiles are ordered on every day', ordered);

  // The cone must widen with time, never narrow.
  let widening = true;
  for (let i = 1; i < out.bands.length; i++) {
    const prev = out.bands[i - 1].p97_5 - out.bands[i - 1].p2_5;
    const cur = out.bands[i].p97_5 - out.bands[i].p2_5;
    if (cur < prev * 0.97) { widening = false; break; }
  }
  ok('the cone widens with horizon', widening);

  // No drift and no magnets: a coin flip, slightly under 50% because the
  // median of a log-normal sits below its starting point.
  near('odds of finishing higher are near 50%', out.higherPct, 49, 1.5);
  ok('no bend recorded without magnets', out.bendSaturation === 0);
}

// --- drift moves the distribution the right way ------------------------------
{
  const base = { spot: 500, volatility: 0.2, horizon: 20, paths: 20000, magnets: [], crashThreshold: 0.08, seed: 5 };
  const up = simulate({ ...base, annualDrift: 0.08 });
  const down = simulate({ ...base, annualDrift: -0.08 });
  ok('positive drift raises the odds of finishing higher', up.higherPct > down.higherPct + 2,
    `up ${up.higherPct.toFixed(1)}% vs down ${down.higherPct.toFixed(1)}%`);
  ok('positive drift lifts the median', up.bands[19].p50 > down.bands[19].p50);
}

// --- magnets shape the distribution -----------------------------------------
{
  const base = {
    spot: 500, volatility: 0.35, annualDrift: 0, horizon: 20,
    paths: 20000, crashThreshold: 0.08, seed: 11,
  };
  const none = simulate({ ...base, magnets: [] });

  // A strong attractor sitting at spot should compress the distribution.
  const pin = simulate({
    ...base,
    magnets: [{ tradingDay: 20, strikes: [{ strike: 500, weight: 1 }] }],
  });
  const noneWidth = none.bands[19].p84 - none.bands[19].p16;
  const pinWidth = pin.bands[19].p84 - pin.bands[19].p16;
  ok('an attractor at spot compresses the 68% band', pinWidth < noneWidth,
    `pinned ${pinWidth.toFixed(2)} vs free ${noneWidth.toFixed(2)}`);

  // A repeller at spot should do the opposite.
  const push = simulate({
    ...base,
    magnets: [{ tradingDay: 20, strikes: [{ strike: 500, weight: -1 }] }],
  });
  const pushWidth = push.bands[19].p84 - push.bands[19].p16;
  ok('a repeller at spot widens the 68% band', pushWidth > noneWidth,
    `repelled ${pushWidth.toFixed(2)} vs free ${noneWidth.toFixed(2)}`);

  // An attractor well above spot should drag the median up.
  const above = simulate({
    ...base,
    magnets: [{ tradingDay: 20, strikes: [{ strike: 515, weight: 1 }] }],
  });
  ok('an attractor above spot lifts the median',
    above.bands[19].p50 > none.bands[19].p50,
    `${above.bands[19].p50.toFixed(2)} vs ${none.bands[19].p50.toFixed(2)}`);

  // Even a maximal field must not overwhelm the randomness: the 68% band has
  // to stay meaningfully wide. This is the property the sigma cap protects.
  ok('magnets never collapse the distribution', pinWidth > noneWidth * 0.35,
    `pinned band ${pinWidth.toFixed(2)} vs free ${noneWidth.toFixed(2)}`);
}

// --- crash estimate ---------------------------------------------------------
{
  // Higher volatility must produce more 8% drawdowns.
  const mk = (vol) => simulate({
    spot: 500, volatility: vol, annualDrift: 0, horizon: 20,
    paths: 20000, magnets: [], crashThreshold: 0.08, seed: 3,
  }).crashPct;
  const calm = mk(0.10), wild = mk(0.45);
  ok('crash odds rise with volatility', wild > calm,
    `10% vol -> ${calm.toFixed(2)}%, 45% vol -> ${wild.toFixed(2)}%`);
  ok('crash odds are a valid percentage', calm >= 0 && wild <= 100);
}

failures.forEach((f) => console.log(f));
console.log(
  `${checks - failures.length}/${checks} checks passed` +
  (failures.length === 0 ? '  — ALL GREEN' : `  — ${failures.length} FAILURES`),
);
process.exit(failures.length === 0 ? 0 : 1);
