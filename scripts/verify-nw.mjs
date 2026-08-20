/*
 * Validation of the Nadaraya-Watson envelope in src/lib/scanner/nadarayaWatson.ts.
 *
 * The *reference* is transcribed here from the Pine source rather than
 * imported, so the module is checked against an independent statement of the
 * maths rather than against itself. The module itself is imported and is the
 * subject — Node 22.6+ strips the types, and on an older Node section 1 says
 * so and falls back to a weaker check rather than reporting a pass it did not
 * earn.
 *
 * Three things this exists to catch, all of which produce a confident,
 * plausible, wrong band rather than an obvious break:
 *
 *   1. The repainting formulation. The widely-copied TradingView envelope
 *      refits across the whole visible series, so historical values change as
 *      new bars arrive. A scanner built on that disagrees with the reader's
 *      own chart by the time they open it, and nothing about the output looks
 *      wrong. Section 2 tests the property directly: values computed from a
 *      truncated series must be bit-identical to the same bars computed from
 *      the full one.
 *
 *   2. An off-by-one in the kernel window, which shifts the whole band by a
 *      bar and silently flips the state of anything sitting near an edge.
 *
 *   3. A band width measured over the wrong window. The centre line is
 *      dominated by the nearest few bars — the Gaussian weight at offset 40 is
 *      about 3e-6 — so a wrong lookback barely moves it. The mean absolute
 *      error is a flat average, so the same mistake moves the band edges a
 *      lot, and the edges are what the pass/fail state is read off.
 *
 * The last section fetches real SPY daily bars and prints the current reading
 * for comparison against a chart. It is skipped, not failed, without network.
 *
 * Run: npm run verify:nw
 */

const H = 8;
const LOOKBACK = 499;
const MULT = 3;

let failures = 0;
let checks = 0;
let skipped = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function near(label, actual, expected, tolerance = 1e-9) {
  ok(
    label,
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `got ${actual}, expected ${expected}`,
  );
}

/*
 * Reference implementation, transcribed from the non-repainting LuxAlgo
 * envelope:
 *
 *   for i = 0 to math.min(499, n)
 *       w = math.exp(-(math.pow(i, 2) / (h * h * 2)))
 *       out += src[i] * w
 *       coefs += w
 *   out /= coefs
 *   mae = ta.sma(math.abs(src - out), 499) * mult
 *
 * Written as the plainest possible double loop. It is O(n * lookback) and the
 * implementation under test is not, which is part of what is being checked.
 */
function referenceEnvelope(closes, h = H, lookback = LOOKBACK, mult = MULT) {
  const mid = [];
  for (let t = 0; t < closes.length; t += 1) {
    let num = 0;
    let den = 0;
    const span = Math.min(lookback, t + 1);
    for (let i = 0; i < span; i += 1) {
      const w = Math.exp(-((i * i) / (h * h * 2)));
      num += closes[t - i] * w;
      den += w;
    }
    mid.push(num / den);
  }

  const out = [];
  for (let t = 0; t < closes.length; t += 1) {
    const span = Math.min(lookback, t + 1);
    let sum = 0;
    for (let j = t - span + 1; j <= t; j += 1) sum += Math.abs(closes[j] - mid[j]);
    const mae = (sum / span) * mult;
    out.push({ mid: mid[t], upper: mid[t] + mae, lower: mid[t] - mae });
  }
  return out;
}

/** Deterministic pseudo-random walk, so runs are comparable. */
function syntheticCloses(n, seed = 42) {
  let state = seed;
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    price *= 1 + ((state / 2147483648) - 0.5) * 0.02;
    out.push(price);
  }
  return out;
}

// --- section 1: against the reference ---------------------------------------

console.log('\nNadaraya-Watson envelope\n');
console.log('1. Against an independently transcribed reference');

/*
 * The real module, when this Node can strip types (22.6+ / 24, which is what
 * the project builds on). On an older Node the import fails and section 1
 * degrades to checking the inline mirror below against the reference — which
 * is a weaker check, so it says so rather than reporting a pass it did not
 * earn.
 */
let realModule = null;
try {
  realModule = await import('../src/lib/scanner/nadarayaWatson.ts');
} catch {
  realModule = null;
}

/**
 * Structural mirror of the implementation: precomputed weights, running MAE.
 *
 * Used for the live section, and as the fallback subject of section 1 on a
 * Node too old to import the real thing.
 */
function underTest(closes, h = H, lookback = LOOKBACK, mult = MULT) {
  const span = Math.min(lookback, closes.length);
  const w = [];
  for (let i = 0; i < span; i += 1) w.push(Math.exp(-(i * i) / (2 * h * h)));

  const mid = [];
  for (let t = 0; t < closes.length; t += 1) {
    const use = Math.min(w.length, t + 1);
    let num = 0;
    let den = 0;
    for (let i = 0; i < use; i += 1) {
      num += closes[t - i] * w[i];
      den += w[i];
    }
    mid.push(den > 0 ? num / den : closes[t]);
  }

  const out = [];
  let sum = 0;
  for (let t = 0; t < closes.length; t += 1) {
    sum += Math.abs(closes[t] - mid[t]);
    if (t >= lookback) sum -= Math.abs(closes[t - lookback] - mid[t - lookback]);
    const width = (sum / Math.min(lookback, t + 1)) * mult;
    out.push({ mid: mid[t], upper: mid[t] + width, lower: mid[t] - width });
  }
  return out;
}

{
  const closes = syntheticCloses(600);
  const expected = referenceEnvelope(closes);

  let actual;
  if (realModule) {
    console.log('   subject: src/lib/scanner/nadarayaWatson.ts');
    actual = realModule
      .nadarayaWatson(closes, { bandwidth: H, lookback: LOOKBACK, mult: MULT })
      .points;
  } else {
    skipped += 1;
    console.log(
      '   NOTE — this Node cannot import TypeScript, so the inline mirror is',
    );
    console.log(
      '   being checked instead of the module itself. Run on Node 22.6+ for',
    );
    console.log('   the real check.');
    actual = underTest(closes);
  }

  let worstMid = 0;
  let worstEdge = 0;
  for (let i = 0; i < closes.length; i += 1) {
    worstMid = Math.max(worstMid, Math.abs(actual[i].mid - expected[i].mid));
    worstEdge = Math.max(worstEdge, Math.abs(actual[i].upper - expected[i].upper));
  }

  // Floating-point summation order differs between the two (running vs. flat
  // sum), so an exact match is not the right bar; anything above rounding is.
  ok('centre line matches reference', worstMid < 1e-9, `worst ${worstMid}`);
  ok('band edges match reference', worstEdge < 1e-9, `worst ${worstEdge}`);

  // A constant series has no error, so the band must collapse onto the line.
  const flat = actualEnvelope(new Array(300).fill(50));
  near('flat series: centre equals price', flat[299].mid, 50, 1e-9);
  near('flat series: band width is zero', flat[299].upper - flat[299].lower, 0, 1e-9);
}

/** The envelope as computed by whichever subject section 1 selected. */
function actualEnvelope(closes, h = H, lookback = LOOKBACK, mult = MULT) {
  if (realModule) {
    return realModule.nadarayaWatson(closes, { bandwidth: h, lookback, mult }).points;
  }
  return underTest(closes, h, lookback, mult);
}

// --- section 2: non-repainting ----------------------------------------------

console.log('2. Non-repainting property');

{
  const closes = syntheticCloses(600);

  const full = actualEnvelope(closes);
  const truncated = actualEnvelope(closes.slice(0, 500));

  let worst = 0;
  for (let i = 0; i < 500; i += 1) {
    worst = Math.max(worst, Math.abs(full[i].mid - truncated[i].mid));
    worst = Math.max(worst, Math.abs(full[i].upper - truncated[i].upper));
  }

  /*
   * The whole point. Adding a hundred future bars must not change a single
   * historical value. The repainting formulation fails this by a wide margin
   * — typically several tenths of a percent of price on a series like this —
   * so the threshold does not need to be delicate.
   */
  ok('adding future bars changes no past value', worst === 0, `worst drift ${worst}`);

  // And the reverse: the newest value must depend only on the newest bars.
  const bumped = closes.slice();
  bumped[0] *= 1.5;
  const withBumpedFirstBar = actualEnvelope(bumped);
  const weightAtEnd = Math.exp(-((599 * 599) / (2 * H * H)));
  ok(
    'the oldest bar carries no weight at the newest bar',
    weightAtEnd < 1e-300 &&
      Math.abs(withBumpedFirstBar[599].mid - full[599].mid) < 1e-9,
    `weight ${weightAtEnd}`,
  );
}

// --- section 3: window sensitivity ------------------------------------------

console.log('3. The lookback matters to the band, not to the line');

{
  const closes = syntheticCloses(600);
  const wide = actualEnvelope(closes, H, 499);
  const narrow = actualEnvelope(closes, H, 120);

  const midDrift = Math.abs(wide[599].mid - narrow[599].mid);
  const edgeDrift = Math.abs(wide[599].upper - narrow[599].upper);

  /*
   * Documenting the asymmetry that makes a wrong lookback hard to spot by eye:
   * the centre line is unaffected because the Gaussian tail is negligible, so
   * a chart drawn with the wrong lookback looks right and its band edges — the
   * thing the pass/fail state is actually read off — are wrong.
   */
  ok('centre line is insensitive to the lookback', midDrift < 1e-6, `drift ${midDrift}`);
  ok(
    'band width IS sensitive to the lookback',
    edgeDrift > midDrift * 1000,
    `mid ${midDrift} vs edge ${edgeDrift}`,
  );
  console.log(
    `   lookback 499 vs 120 on the same series: centre moves ${midDrift.toExponential(2)}, ` +
      `band edge moves ${edgeDrift.toFixed(4)}`,
  );
}

// --- section 4: the live SPY reading ----------------------------------------

console.log('4. Live SPY reading, for comparison against a chart');

try {
  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/SPY' +
    '?range=2y&interval=1d&includePrePost=false';

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = await response.json();
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};

  const closes = [];
  const dates = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const c = quote.close?.[i];
    if (typeof c !== 'number') continue;
    closes.push(c);
    dates.push(new Date(stamps[i] * 1000).toISOString().slice(0, 10));
  }

  if (closes.length < 200) throw new Error(`only ${closes.length} bars`);

  const band = actualEnvelope(closes);
  const last = band[band.length - 1];
  const close = closes[closes.length - 1];
  const state = close > last.upper ? 'above' : close < last.lower ? 'below' : 'inside';

  console.log(`   SPY daily, ${closes.length} bars to ${dates[dates.length - 1]}`);
  console.log(`   settings   h=${H}  lookback=${LOOKBACK}  mult=${MULT}`);
  console.log(`   close      ${close.toFixed(2)}`);
  console.log(`   upper      ${last.upper.toFixed(2)}`);
  console.log(`   centre     ${last.mid.toFixed(2)}`);
  console.log(`   lower      ${last.lower.toFixed(2)}`);
  console.log(`   state      ${state}`);
  console.log('');
  console.log('   Compare these four numbers against the Nadaraya-Watson Envelope');
  console.log('   (non-repainting) on your SPY daily chart with the same three');
  console.log('   settings. They should agree to the cent. If they do not, the');
  console.log('   likeliest cause is a different bandwidth or multiplier on the');
  console.log('   chart — set GAMMADESK_SCAN_NW_H / _LOOKBACK / _MULT to match.');

  checks += 1;
} catch (error) {
  skipped += 1;
  console.log(`   SKIPPED — ${error instanceof Error ? error.message : error}`);
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed${skipped > 0 ? `, ${skipped} skipped` : ''}\n`);
