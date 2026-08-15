/*
 * Validation of the relative-strength engine in src/lib/rs/.
 *
 * As with scripts/verify-greeks.js, the logic is transcribed here rather than
 * imported, so this is an independent check rather than a function tested
 * against itself. Keep the two in sync when either changes.
 *
 * The last section is different in kind: it fetches the real constituent
 * sources and runs the real parsers over them. That code scrapes HTML, which
 * is the one part of this feature that can break without any commit — so it is
 * checked against the live page rather than a fixture. It is skipped, not
 * failed, when there is no network.
 *
 * Run: npm run verify:rs
 */

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function near(label, actual, expected, tolerance = 1e-9) {
  ok(
    label,
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

// ---- transcribed from rank.ts ----------------------------------------------

function percentileRanks(values) {
  const present = values.filter((v) => v !== null && Number.isFinite(v));
  const n = present.length;
  if (n === 0) return values.map(() => null);
  const sorted = [...present].sort((a, b) => a - b);

  const lower = (x) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const upper = (x) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= x) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return null;
    const below = lower(v);
    const equal = upper(v) - below;
    return ((below + equal / 2) / n) * 100;
  });
}

function composite(percentiles, weights) {
  let sum = 0, total = 0;
  for (const key of ['m1', 'm3', 'm6']) {
    const pct = percentiles[key];
    const weight = weights[key];
    if (pct === null || !(weight > 0)) continue;
    sum += pct * weight;
    total += weight;
  }
  return total <= 0 ? null : sum / total;
}

function normaliseWeights(raw) {
  const clean = (v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const m1 = clean(raw.m1), m3 = clean(raw.m3), m6 = clean(raw.m6);
  const total = m1 + m3 + m6;
  if (total <= 0) return { m1: 0.2, m3: 0.5, m6: 0.3 };
  return { m1: m1 / total, m3: m3 / total, m6: m6 / total };
}

function adjustmentFactor(storedDates, storedCloses, incoming) {
  const fresh = new Map(incoming.map((b) => [b.date, b.close]));
  const ratios = [];
  for (let i = 0; i < storedDates.length; i++) {
    const was = storedCloses[i];
    const now = fresh.get(storedDates[i]);
    if (was === null || was === undefined || !now || was <= 0) continue;
    ratios.push(now / was);
  }
  if (ratios.length < 20) return 1;
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  if (!Number.isFinite(median) || median <= 0 || Math.abs(median - 1) < 0.05) return 1;
  return median;
}

// ---- 1. percentile ranks ----------------------------------------------------

console.log('\nPercentile ranks');

{
  // Brute force, O(n^2), as the reference the binary-search version must match.
  const brute = (values) => {
    const present = values.filter((v) => v !== null);
    const n = present.length;
    return values.map((v) => {
      if (v === null) return null;
      const below = present.filter((x) => x < v).length;
      const equal = present.filter((x) => x === v).length;
      return ((below + equal / 2) / n) * 100;
    });
  };

  // Deterministic pseudo-random sample with deliberate ties and nulls.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const sample = Array.from({ length: 500 }, () => {
    const r = rand();
    if (r < 0.05) return null;
    // Rounded hard, so ties are common — the case midranks exist to handle.
    return Math.round(rand() * 20) / 20;
  });

  const fast = percentileRanks(sample);
  const slow = brute(sample);
  let maxDiff = 0;
  for (let i = 0; i < sample.length; i++) {
    if (fast[i] === null || slow[i] === null) {
      ok(`null preserved at ${i}`, fast[i] === null && slow[i] === null);
      continue;
    }
    maxDiff = Math.max(maxDiff, Math.abs(fast[i] - slow[i]));
  }
  near('binary search matches brute force over 500 values', maxDiff, 0, 1e-12);

  const single = percentileRanks([5]);
  near('a lone value sits at the midpoint', single[0], 50);

  const allTied = percentileRanks([3, 3, 3, 3]);
  ok('a universe of ties is all 50', allTied.every((v) => v === 50), JSON.stringify(allTied));

  const ordered = percentileRanks([1, 2, 3, 4]);
  near('lowest of four', ordered[0], 12.5);
  near('highest of four', ordered[3], 87.5);
  ok('nothing ever reaches 0 or 100', ordered.every((v) => v > 0 && v < 100));

  const withNulls = percentileRanks([10, null, 20, null, 30]);
  ok('nulls stay null', withNulls[1] === null && withNulls[3] === null);
  near('nulls are excluded from the denominator', withNulls[0], (0 + 0.5) / 3 * 100);

  ok('an all-null window yields all nulls',
    percentileRanks([null, null]).every((v) => v === null));

  // The property that makes the score meaningful: rank order is preserved.
  const monotone = percentileRanks([-0.5, 0.1, 0.0, 0.9]);
  ok('ranking is monotone in performance',
    monotone[0] < monotone[2] && monotone[2] < monotone[1] && monotone[1] < monotone[3]);
}

// ---- 2. blending -----------------------------------------------------------

console.log('Blend and weights');

{
  const w = normaliseWeights({ m1: 20, m3: 50, m6: 30 });
  near('default weights normalise to 0.2', w.m1, 0.2);
  near('default weights normalise to 0.5', w.m3, 0.5);
  near('default weights normalise to 0.3', w.m6, 0.3);

  const equal = normaliseWeights({ m1: 30, m3: 30, m6: 30 });
  near('30/30/30 renormalises to a third', equal.m3, 1 / 3, 1e-12);

  const zero = normaliseWeights({ m1: 0, m3: 0, m6: 0 });
  near('all-zero falls back to the default 3mo weight', zero.m3, 0.5);

  const negative = normaliseWeights({ m1: -50, m3: 50, m6: 0 });
  near('a negative weight is clamped away', negative.m1, 0);
  near('and the rest take the whole blend', negative.m3, 1);

  near('full blend', composite({ m1: 90, m3: 60, m6: 40 }, w), 90 * 0.2 + 60 * 0.5 + 40 * 0.3);

  // A missing window must renormalise, not count as zero. This is the check
  // that catches a newly listed stock being scored as the weakest in the index.
  const short = composite({ m1: 80, m3: 60, m6: null }, w);
  near('a missing window renormalises over the rest', short, (80 * 0.2 + 60 * 0.5) / 0.7);
  ok('and does not drag the score down', short > 60, `got ${short}`);

  ok('no windows at all yields null', composite({ m1: null, m3: null, m6: null }, w) === null);

  // A zero-weighted window must not contribute even when present.
  near('a zero weight excludes its window',
    composite({ m1: 100, m3: 50, m6: 50 }, { m1: 0, m3: 0.5, m6: 0.5 }), 50);

  // Bounds: a blend of percentiles can never leave 0-100.
  const w2 = normaliseWeights({ m1: 7, m3: 11, m6: 3 });
  let outOfRange = 0;
  for (let i = 0; i <= 100; i += 7) {
    for (let j = 0; j <= 100; j += 11) {
      const s = composite({ m1: i, m3: j, m6: (i + j) / 2 }, w2);
      if (s < 0 || s > 100) outOfRange++;
    }
  }
  ok('the blend stays inside 0-100', outOfRange === 0, `${outOfRange} escapes`);
}

// ---- 3. window arithmetic ---------------------------------------------------

console.log('Return windows');

{
  const WINDOWS = { m1: 21, m3: 63, m6: 126 };
  const LOOKBACK = 5;

  // A series compounding at exactly 1% per session makes every window's
  // expected return closed-form, so an off-by-one in the offsets shows up.
  const n = 300;
  const series = Array.from({ length: n }, (_, i) => 100 * Math.pow(1.01, i));
  const last = n - 1;
  const ret = (from, to) => (from >= 0 ? series[to] / series[from] - 1 : null);

  near('1mo return spans exactly 21 sessions', ret(last - WINDOWS.m1, last), Math.pow(1.01, 21) - 1, 1e-9);
  near('3mo return spans exactly 63 sessions', ret(last - WINDOWS.m3, last), Math.pow(1.01, 63) - 1, 1e-9);
  near('6mo return spans exactly 126 sessions', ret(last - WINDOWS.m6, last), Math.pow(1.01, 126) - 1, 1e-9);

  const back = last - LOOKBACK;
  near('the prior reading is the same window, five sessions earlier',
    ret(back - WINDOWS.m1, back), Math.pow(1.01, 21) - 1, 1e-9);

  // Short history: the floor is 21 + 5 + 1 sessions, below which nothing is
  // computable and the symbol must be reported as pending rather than ranked.
  const MIN_BARS = WINDOWS.m1 + LOOKBACK + 1;
  near('the minimum bar count is 27', MIN_BARS, 27);

  const shortSeries = Array.from({ length: 40 }, (_, i) => 100 + i);
  const sLast = shortSeries.length - 1;
  const sRet = (from, to) => (from >= 0 ? shortSeries[to] / shortSeries[from] - 1 : null);
  ok('a 40-bar history has a 1mo return', sRet(sLast - WINDOWS.m1, sLast) !== null);
  ok('but no 3mo return', sRet(sLast - WINDOWS.m3, sLast) === null);
  ok('and no 6mo return', sRet(sLast - WINDOWS.m6, sLast) === null);

  // A flat series must produce exactly zero, not a float artefact that would
  // sort arbitrarily against other flat names.
  const flat = new Array(200).fill(50);
  near('a flat series returns exactly zero', flat[199] / flat[199 - 21] - 1, 0, 0);
}

// ---- 4. split adjustment ----------------------------------------------------

console.log('Split adjustment');

{
  const dates = Array.from({ length: 250 }, (_, i) =>
    new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));

  const stored = dates.map((_, i) => 100 + i * 0.1);

  // No corporate action: the upstream agrees with what we stored.
  const same = dates.map((d, i) => ({ date: d, close: stored[i] }));
  near('an unchanged history is not rescaled', adjustmentFactor(dates, stored, same), 1);

  // A 2-for-1 split three sessions ago: everything before it halves.
  const splitAt = dates.length - 3;
  const halved = dates.map((d, i) => ({
    date: d,
    close: i < splitAt ? stored[i] / 2 : stored[i] / 2,
  }));
  near('a 2-for-1 split is detected as a 0.5 factor',
    adjustmentFactor(dates, stored, halved), 0.5, 1e-12);

  // One bad print must not rescale a decade of prices — this is why it is a
  // median rather than a mean.
  const oneBadPrint = dates.map((d, i) => ({
    date: d,
    close: i === 100 ? stored[i] * 0.4 : stored[i],
  }));
  near('a single bad print does not move the median',
    adjustmentFactor(dates, oneBadPrint.map((_, i) => stored[i]), oneBadPrint), 1);

  // Small drift stays below the 5% floor and is left alone.
  const drift = dates.map((d, i) => ({ date: d, close: stored[i] * 1.02 }));
  near('2% drift is treated as noise', adjustmentFactor(dates, stored, drift), 1);

  // Too little overlap to judge: leave the history alone.
  const tinyOverlap = dates.slice(0, 10).map((d, i) => ({ date: d, close: stored[i] / 2 }));
  near('under 20 overlapping sessions, nothing is rescaled',
    adjustmentFactor(dates, stored, tinyOverlap), 1);

  // And the rescale itself must remove the cliff it was diagnosing.
  const factor = adjustmentFactor(dates, stored, halved);
  const repaired = stored.map((v) => v * factor);
  const cliff = Math.abs(repaired[splitAt - 1] / halved[splitAt - 1].close - 1);
  near('rescaling removes the discontinuity', cliff, 0, 1e-12);
}

// ---- 5. retroactive split adjustment ---------------------------------------

// Transcribed from history.ts.
function applySplits(bars, declared) {
  if (!declared || declared.length === 0) return bars;
  const all = [...declared].sort((a, b) => a.date.localeCompare(b.date));

  // Only splits the series has not already been adjusted for.
  const sorted = all.filter(({ date, ratio }) => {
    let before = null, after = null;
    for (const bar of bars) {
      if (bar.date < date) before = bar.close;
      else { after = bar.close; break; }
    }
    if (before === null || after === null || after <= 0) return false;
    return Math.abs((before / after) / ratio - 1) < 0.15;
  });
  if (sorted.length === 0) return bars;

  const pending = new Array(sorted.length + 1).fill(1);
  for (let i = sorted.length - 1; i >= 0; i--) pending[i] = pending[i + 1] * sorted[i].ratio;
  let next = 0;
  return bars.map((bar) => {
    while (next < sorted.length && sorted[next].date <= bar.date) next++;
    const factor = pending[next];
    if (factor === 1) return bar;
    return { date: bar.date, close: bar.close / factor, volume: bar.volume * factor };
  });
}

console.log('Split adjustment (retroactive, from the events feed)');

{
  const dateAt = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

  /**
   * A flat stock served the way the upstream serves an UNADJUSTED split:
   * `base` before the split index, `base / ratio` from it onwards.
   */
  const rawSeries = (n, splitIdx, ratio, base = 100) =>
    Array.from({ length: n }, (_, i) => ({
      date: dateAt(i),
      close: i >= splitIdx ? base / ratio : base,
      volume: i >= splitIdx ? 1_000_000 * ratio : 1_000_000,
    }));

  /** The same stock once the upstream HAS adjusted it: continuous throughout. */
  const adjustedSeries = (n, base = 100) =>
    Array.from({ length: n }, (_, i) => ({
      date: dateAt(i), close: base, volume: 1_000_000,
    }));

  // --- the MNST case: a recent, unadjusted 2-for-1 ---
  const raw = rawSeries(30, 27, 2);
  near('unadjusted, a 2-for-1 split reads as a 50% crash',
    raw[29].close / raw[8].close - 1, -0.5);

  const fixed = applySplits(raw, [{ date: dateAt(27), ratio: 2 }]);
  near('pre-split closes are halved', fixed[26].close, 50);
  near('the split session onwards is untouched', fixed[27].close, 50);
  near('pre-split volume is doubled', fixed[26].volume, 2_000_000);
  near('dollar volume is continuous across the split',
    fixed[26].close * fixed[26].volume, fixed[27].close * fixed[27].volume);
  near('and the series reads correctly flat afterwards',
    fixed[29].close / fixed[8].close - 1, 0, 1e-12);

  // --- the DECK/LRCX case: a split the upstream ALREADY applied ---
  // Applying it a second time is what invented 26 -> 155 gaps, so it must be
  // detected and skipped.
  const already = adjustedSeries(30);
  const untouched = applySplits(already, [{ date: dateAt(10), ratio: 6 }]);
  ok('an already-adjusted split is left alone',
    untouched.every((b) => b.close === 100),
    `got ${untouched[5].close} before the split date`);
  near('so no fake cliff appears', untouched[29].close / untouched[0].close, 1);

  // --- no events at all ---
  ok('no events means no change',
    applySplits(adjustedSeries(5), []).every((b) => b.close === 100));

  // --- two unadjusted splits must compound ---
  const twoRaw = Array.from({ length: 12 }, (_, i) => ({
    date: dateAt(i),
    close: i >= 8 ? 100 / 6 : i >= 4 ? 100 / 2 : 100,
    volume: 1_000_000,
  }));
  const compounded = applySplits(twoRaw, [
    { date: dateAt(4), ratio: 2 },
    { date: dateAt(8), ratio: 3 },
  ]);
  ok('two unadjusted splits compound into one continuous series',
    compounded.every((b) => Math.abs(b.close - 100 / 6) < 1e-9),
    JSON.stringify(compounded.map((b) => Number(b.close.toFixed(3)))));

  // --- a reverse split moves prices the other way ---
  const rev = rawSeries(10, 5, 0.1);
  const reversed = applySplits(rev, [{ date: dateAt(5), ratio: 0.1 }]);
  near('a 1-for-10 reverse split multiplies old prices by 10', reversed[4].close, 1000);
  near('and divides old volume by 10', reversed[4].volume, 100_000);
  ok('leaving the reverse-split series continuous',
    Math.abs(reversed[4].close - reversed[5].close) < 1e-9);

  // --- a genuine crash must not be mistaken for a split ---
  const crash = Array.from({ length: 20 }, (_, i) => ({
    date: dateAt(i), close: i >= 10 ? 63 : 100, volume: 1_000_000,
  }));
  const notASplit = applySplits(crash, [{ date: dateAt(10), ratio: 2 }]);
  ok('a 37% drop is not treated as a 2-for-1 split',
    notASplit[9].close === 100, `got ${notASplit[9].close}`);

  // But a real split where the stock also moved 6% that day IS still caught —
  // the tolerance has to admit ordinary movement on the split session.
  const splitAndMoved = Array.from({ length: 20 }, (_, i) => ({
    date: dateAt(i), close: i >= 10 ? 53 : 100, volume: 1_000_000,
  }));
  const caught = applySplits(splitAndMoved, [{ date: dateAt(10), ratio: 2 }]);
  near('a 2-for-1 with a 6% move on the day is still adjusted', caught[9].close, 50);
}

// ---- 6. liquidity and volume confirmation ----------------------------------

console.log('Liquidity and volume confirmation');

{
  const LIQUIDITY_WINDOW = 20, VOLUME_RECENT = 21, VOLUME_BASELINE = 63;

  // Transcribed from refresh.ts.
  const liquidity = (closes, volumes) => {
    const n = closes.length;
    const from = Math.max(0, n - LIQUIDITY_WINDOW);
    let dollars = 0, counted = 0;
    for (let i = from; i < n; i++) {
      if (volumes[i] > 0) { dollars += closes[i] * volumes[i]; counted++; }
    }
    return counted > 0 ? dollars / counted : 0;
  };

  const meanVolume = (volumes, from, to) => {
    if (from < 0 || to <= from) return null;
    let sum = 0, seen = 0;
    for (let i = from; i < to; i++) if (volumes[i] > 0) { sum += volumes[i]; seen++; }
    return seen >= (to - from) * 0.6 ? sum / seen : null;
  };

  const n = 200;
  const closes = new Array(n).fill(50);
  const flatVol = new Array(n).fill(1_000_000);

  near('dollar volume is price times shares', liquidity(closes, flatVol), 50_000_000);

  // Dollar volume, not share volume — the distinction the floor depends on.
  const pennyCloses = new Array(n).fill(2);
  ok('a low-priced stock on the same share volume is far less liquid',
    liquidity(pennyCloses, flatVol) < liquidity(closes, flatVol) / 20);

  const ratio = (volumes) => {
    const recentFrom = n - VOLUME_RECENT;
    const recent = meanVolume(volumes, recentFrom, n);
    const baseline = meanVolume(volumes, recentFrom - VOLUME_BASELINE, recentFrom);
    return recent !== null && baseline !== null && baseline > 0 ? recent / baseline : null;
  };

  near('flat volume gives a ratio of exactly 1', ratio(flatVol), 1);

  const surging = flatVol.map((v, i) => (i >= n - VOLUME_RECENT ? v * 2 : v));
  near('a doubling in the recent window reads as 2x', ratio(surging), 2);

  const fading = flatVol.map((v, i) => (i >= n - VOLUME_RECENT ? v * 0.5 : v));
  near('a halving reads as 0.5x', ratio(fading), 0.5);

  // The baseline must exclude the recent window, or a surge would inflate its
  // own denominator and the ratio would understate the move.
  const baselineOnly = meanVolume(surging, n - VOLUME_RECENT - VOLUME_BASELINE, n - VOLUME_RECENT);
  near('the baseline is untouched by the recent surge', baselineOnly, 1_000_000);

  const confirmationOf = (r) =>
    r === null || !Number.isFinite(r) ? null : (r >= 1 ? 'confirmed' : 'unconfirmed');

  ok('rising volume confirms', confirmationOf(ratio(surging)) === 'confirmed');
  ok('fading volume does not', confirmationOf(ratio(fading)) === 'unconfirmed');
  ok('flat volume sits on the confirmed side of the line',
    confirmationOf(ratio(flatVol)) === 'confirmed');
  ok('unknown stays null rather than becoming unconfirmed',
    confirmationOf(null) === null);

  // Too short to have a baseline at all.
  const shortVol = new Array(30).fill(1_000_000);
  ok('a short history yields no ratio',
    meanVolume(shortVol, 30 - VOLUME_RECENT - VOLUME_BASELINE, 30 - VOLUME_RECENT) === null);

  // Mostly-missing volume must not read as a collapse in trading.
  const patchy = flatVol.map((v, i) => (i >= n - VOLUME_RECENT && i % 3 !== 0 ? 0 : v));
  ok('a window that is mostly missing yields null, not a fake ratio',
    meanVolume(patchy, n - VOLUME_RECENT, n) === null);

  // The liquidity floor must be applied BEFORE ranking: excluding a name has
  // to change the percentiles of everyone else, or the filter is cosmetic.
  const entries = [
    { symbol: 'THIN', ret: 0.90, adv: 1_000_000 },
    { symbol: 'BIG1', ret: 0.50, adv: 500_000_000 },
    { symbol: 'BIG2', ret: 0.10, adv: 500_000_000 },
    { symbol: 'BIG3', ret: -0.20, adv: 500_000_000 },
  ];
  const unfiltered = percentileRanks(entries.map((e) => e.ret));
  const liquid = entries.filter((e) => e.adv >= 10_000_000);
  const filtered = percentileRanks(liquid.map((e) => e.ret));

  near('with the thin name included, the best liquid name is only 3rd of 4',
    unfiltered[1], (2 + 0.5) / 4 * 100);
  near('excluding it promotes that name to top of 3',
    filtered[0], (2 + 0.5) / 3 * 100);
  ok('so the floor genuinely changes the ranking', filtered[0] > unfiltered[1]);
}

// ---- 7. the live constituent sources ---------------------------------------

// Transcribed from membership.ts.

const stripTags = (html) =>
  html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();

function parseWikipedia(html) {
  const start = html.indexOf('id="constituents"');
  if (start === -1) return [];
  const tableEnd = html.indexOf('</table>', start);
  const table = html.slice(start, tableEnd === -1 ? undefined : tableEnd);
  const rows = table.split(/<tr\b/i).slice(1);
  if (rows.length === 0) return [];
  const headers = [...rows[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => stripTags(m[1]).toLowerCase());
  const symbolAt = headers.findIndex((h) => h.startsWith('symbol') || h === 'ticker');
  const sectorAt = headers.findIndex((h) => h.includes('sector'));
  if (symbolAt === -1 || sectorAt === -1) return [];
  const out = [];
  for (const row of rows.slice(1)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => stripTags(m[1]));
    if (cells.length <= Math.max(symbolAt, sectorAt)) continue;
    if (cells[symbolAt]) out.push({ symbol: cells[symbolAt], sector: cells[sectorAt] });
  }
  return out;
}

function csvFields(line) {
  const out = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(field.trim()); field = ''; }
    else field += ch;
  }
  out.push(field.trim());
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = csvFields(lines[0]).map((h) => h.toLowerCase());
  const symbolAt = headers.findIndex((h) => h.startsWith('symbol') || h === 'ticker');
  const sectorAt = headers.findIndex((h) => h.includes('sector'));
  if (symbolAt === -1 || sectorAt === -1) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    if (f.length <= Math.max(symbolAt, sectorAt)) continue;
    if (f[symbolAt]) out.push({ symbol: f[symbolAt], sector: f[sectorAt] });
  }
  return out;
}

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z]{1,2})?$/;
const SECTOR_ALIASES = new Set([
  'informationtechnology', 'technology', 'healthcare', 'health', 'financials',
  'financial', 'consumerdiscretionary', 'consumerstaples', 'communicationservices',
  'telecommunicationservices', 'industrials', 'energy', 'utilities', 'realestate',
  'materials',
]);
const ANCHORS = ['AAPL', 'MSFT', 'JPM', 'JNJ', 'XOM'];

function assess(label, parsed) {
  const clean = parsed
    .map((p) => ({ symbol: p.symbol.trim().toUpperCase(), sector: p.sector }))
    .filter((p) => SYMBOL_PATTERN.test(p.symbol));

  ok(`${label}: parsed a plausible number of symbols (got ${clean.length})`,
    clean.length >= 400 && clean.length <= 600);

  const present = new Set(clean.map((c) => c.symbol));
  const missing = ANCHORS.filter((a) => !present.has(a));
  ok(`${label}: bellwethers present`, missing.length === 0, `missing ${missing.join(', ')}`);

  const recognised = clean.filter((c) =>
    SECTOR_ALIASES.has(String(c.sector).toLowerCase().replace(/[^a-z]/g, ''))).length;
  ok(`${label}: GICS sectors recognised (${recognised}/${clean.length})`,
    recognised >= clean.length * 0.9);

  const dropped = parsed.length - clean.length;
  ok(`${label}: few rows dropped by the symbol filter (${dropped})`, dropped <= 5,
    `dropped ${dropped} rows — the table layout may have changed`);

  return clean;
}

async function checkLiveSources() {
  console.log('Live constituent sources');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

  let wiki = null, csv = null;

  try {
    const res = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies',
      { headers: { 'User-Agent': UA } });
    if (res.ok) wiki = assess('wikipedia', parseWikipedia(await res.text()));
    else ok('wikipedia: reachable', false, `HTTP ${res.status}`);
  } catch (e) {
    console.log(`  SKIP  wikipedia — no network (${e.message})`);
  }

  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv',
      { headers: { 'User-Agent': UA } });
    if (res.ok) csv = assess('csv', parseCsv(await res.text()));
    else ok('csv: reachable', false, `HTTP ${res.status}`);
  } catch (e) {
    console.log(`  SKIP  csv — no network (${e.message})`);
  }

  // The two sources are independent scrapes of the same index. If they
  // disagree by more than a handful of names, one of the parsers is wrong.
  if (wiki && csv) {
    const a = new Set(wiki.map((x) => x.symbol));
    const b = new Set(csv.map((x) => x.symbol));
    const onlyWiki = [...a].filter((s) => !b.has(s));
    const onlyCsv = [...b].filter((s) => !a.has(s));
    ok(`the two sources agree (wiki-only ${onlyWiki.length}, csv-only ${onlyCsv.length})`,
      onlyWiki.length + onlyCsv.length <= 15,
      `wiki-only: ${onlyWiki.join(',')} | csv-only: ${onlyCsv.join(',')}`);
  }
}

// ---- run --------------------------------------------------------------------

checkLiveSources().then(() => {
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} FAILED`);
    process.exit(1);
  }
  console.log('Relative-strength engine verified.\n');
});
