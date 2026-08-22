/*
 * Validation of the volume profile in src/lib/profile/volumeProfile.ts.
 *
 * The module is imported and is the subject — Node 22.6+ strips the types.
 * Every fixture here is hand-constructed so the expected answer is arrived at
 * on paper first and written down as a literal, rather than being whatever the
 * implementation happened to produce.
 *
 * The technique that makes that possible: a zero-volume bar spanning the whole
 * range fixes the bucket edges without contributing anything, and every other
 * bar is a *point* bar (high === low) sitting at a bucket centre. That puts an
 * exact, chosen volume in an exact, chosen bucket, so the value-area walk can
 * be checked against a hand trace rather than against a re-implementation.
 *
 * What this exists to catch, all of which produce a plausible-looking profile
 * rather than an obvious break:
 *
 *   1. An off-by-one in bucket assignment, which shifts the whole profile by
 *      one level and moves the POC to a price it does not belong at. The top
 *      of the range is the dangerous edge: `floor((high - low) / width)` is
 *      exactly `bucketCount` there and must clamp inward.
 *
 *   2. Volume created or destroyed by the spreading rule. The uniform spread
 *      splits a bar across buckets by overlap, and the weights have to sum to
 *      one for every bar or the totals drift with no visible symptom.
 *
 *   3. A value area that expands the wrong way. Taking the lighter neighbour,
 *      or two buckets per step, yields an area that is the right *size* and
 *      the wrong *place* — and it is the place that gets traded off.
 *
 * Run: npm run verify:profile
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
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `got ${actual}, expected ${expected}`,
  );
}

const { buildVolumeProfile } = await import('../src/lib/profile/volumeProfile.ts');

/*
 * All fixtures below share this frame: prices 100 to 110 in 10 buckets, so
 * bucket i spans [100 + i, 101 + i) and its centre is 100.5 + i.
 */
const RANGE_SETTER = { h: 110, l: 100, v: 0 };

/** A point bar at the centre of bucket `i`, carrying `v`. */
const at = (i, v) => ({ h: 100.5 + i, l: 100.5 + i, v });

/** Bucket volumes, rounded past float noise, for comparing against literals. */
const volumes = (profile) =>
  profile.buckets.map((b) => Number(b.volume.toFixed(9)));

// --- 1. flat volume across a flat range gives even buckets -------------------

console.log('\n1. Flat volume across a flat range');

{
  // Five identical bars, each spanning the entire range. A uniform spread has
  // no reason to prefer any level, so all ten buckets must come out equal.
  const bars = Array.from({ length: 5 }, () => ({ h: 110, l: 100, v: 100 }));
  const profile = buildVolumeProfile(bars, { bucketCount: 10 });

  ok('ten buckets', profile.buckets.length === 10, `got ${profile.buckets.length}`);
  near('total volume conserved', profile.totalVolume, 500);

  const even = profile.buckets.every((b) => Math.abs(b.volume - 50) <= 1e-9);
  ok('every bucket holds one tenth of the volume', even, volumes(profile).join(', '));

  near('lowest bucket floor', profile.buckets[0].priceLow, 100);
  near('highest bucket ceiling', profile.buckets[9].priceHigh, 110);
  near('bucket edges meet', profile.buckets[4].priceHigh, profile.buckets[5].priceLow);

  // A dead flat profile has no meaningful POC; what matters is that the tie
  // rule is deterministic rather than drifting with float order.
  ok('POC is the lowest of the tied buckets', profile.pocIndex === 0, `got ${profile.pocIndex}`);

  // 70% of ten equal buckets needs seven of them, taken upward on every tie.
  const va = profile.valueArea;
  ok(
    'value area spans seven buckets from the POC upward',
    va.fromIndex === 0 && va.toIndex === 6,
    `got ${va.fromIndex}..${va.toIndex}`,
  );
}

// --- 2. a single spike bar puts the POC in the right place -------------------

console.log('2. Single spike bar');

{
  // Quiet background across the whole range, then one narrow, heavy bar sitting
  // inside bucket 7 ([107, 108)). The POC has to land there and nowhere else.
  const bars = [
    { h: 110, l: 100, v: 1_000 },
    { h: 110, l: 100, v: 1_000 },
    { h: 107.8, l: 107.2, v: 500_000 },
  ];
  const profile = buildVolumeProfile(bars, { bucketCount: 10 });

  ok('POC is bucket 7', profile.pocIndex === 7, `got ${profile.pocIndex}`);
  near('POC floor', profile.buckets[7].priceLow, 107);
  near('POC ceiling', profile.buckets[7].priceHigh, 108);

  // The spike is narrower than one bucket and wholly inside it, so all of it
  // lands there — plus that bucket's tenth of the two background bars.
  near('POC holds the whole spike plus its share of the background', profile.buckets[7].volume, 500_200);
  near('total volume conserved', profile.totalVolume, 502_000);
  near('max bucket volume matches the POC', profile.maxBucketVolume, 500_200);

  // One bucket already carries 99.6% of everything, so the value area is it.
  ok(
    'value area is the POC alone',
    profile.valueArea.fromIndex === 7 && profile.valueArea.toIndex === 7,
    `got ${profile.valueArea.fromIndex}..${profile.valueArea.toIndex}`,
  );
}

// --- 3. the value area contains exactly the buckets it should ----------------

console.log('3. Value area, hand-traced');

{
  /*
   * Bucket volumes, chosen so the walk is unambiguous at every step:
   *
   *   idx     0   1   2   3    4   5   6   7   8   9
   *   vol     1   2   3   20   8   7   1   1   1   1     total 45
   *
   * Target is 70% of 45 = 31.5. Trace, starting at the POC:
   *
   *   start  idx 3            vol 20
   *   below = 3, above = 8  → up,   to = 4, vol 28
   *   below = 3, above = 7  → up,   to = 5, vol 35  ≥ 31.5, stop
   *
   * So the area is buckets 3..5, VAL 103, VAH 106, enclosing 35.
   */
  const layout = [1, 2, 3, 20, 8, 7, 1, 1, 1, 1];
  const bars = [RANGE_SETTER, ...layout.map((v, i) => at(i, v))];
  const profile = buildVolumeProfile(bars, { bucketCount: 10 });

  ok(
    'buckets match the intended layout',
    JSON.stringify(volumes(profile)) === JSON.stringify(layout),
    volumes(profile).join(', '),
  );
  near('total volume conserved', profile.totalVolume, 45);
  ok('POC is bucket 3', profile.pocIndex === 3, `got ${profile.pocIndex}`);

  const va = profile.valueArea;
  ok('value area runs 3..5', va.fromIndex === 3 && va.toIndex === 5, `got ${va.fromIndex}..${va.toIndex}`);
  near('VAL', va.low, 103);
  near('VAH', va.high, 106);
  near('enclosed volume', va.volume, 35);
  ok('enclosed volume meets the 70% target', va.volume >= 45 * 0.7, `${va.volume} < 31.5`);

  // The buckets left out are exactly the complement, which is the property the
  // drawing depends on: the shaded band is contiguous and everything else is not
  // in it.
  const inside = [3, 4, 5];
  const wrongSide = profile.buckets.some(
    (_, i) => inside.includes(i) !== (i >= va.fromIndex && i <= va.toIndex),
  );
  ok('no bucket is on the wrong side of the boundary', !wrongSide);
}

{
  /*
   * The mirror image, to prove the walk can go down as well as up:
   *
   *   idx     0   1   2   3    4   5   6   7   8   9
   *   vol     1   9   9   20   2   1   1   1   1   1     total 46
   *
   * Target 32.2. From idx 3 (vol 20): below 9 beats above 2 → from = 2, vol 29;
   * below 9 beats above 2 again → from = 1, vol 38 ≥ 32.2, stop. Area 1..3.
   */
  const layout = [1, 9, 9, 20, 2, 1, 1, 1, 1, 1];
  const bars = [RANGE_SETTER, ...layout.map((v, i) => at(i, v))];
  const profile = buildVolumeProfile(bars, { bucketCount: 10 });

  const va = profile.valueArea;
  ok('POC is bucket 3', profile.pocIndex === 3, `got ${profile.pocIndex}`);
  ok('value area runs 1..3', va.fromIndex === 1 && va.toIndex === 3, `got ${va.fromIndex}..${va.toIndex}`);
  near('VAL', va.low, 101);
  near('VAH', va.high, 104);
  near('enclosed volume', va.volume, 38);
}

{
  /*
   * A tie between the two neighbours. Documented to resolve upward, and the
   * point of testing it is that it resolves the *same way every time* rather
   * than following float or iteration order.
   *
   *   idx     0   1   2   3    4   5   6   7   8   9
   *   vol     0   0   5   20   5   0   0   0   0   0     total 30, target 21
   *
   * From idx 3: below 5, above 5 → tie → up, to = 4, vol 25 ≥ 21. Area 3..4.
   */
  const layout = [0, 0, 5, 20, 5, 0, 0, 0, 0, 0];
  const bars = [RANGE_SETTER, ...layout.map((v, i) => at(i, v))];
  const va = buildVolumeProfile(bars, { bucketCount: 10 }).valueArea;

  ok('a tie expands upward', va.fromIndex === 3 && va.toIndex === 4, `got ${va.fromIndex}..${va.toIndex}`);
}

// --- 4. the spreading rule neither creates nor destroys volume ---------------

console.log('4. Volume conservation under the spread');

{
  // Ragged, overlapping, off-grid bars: exactly the case where a bucket-edge
  // mistake leaks volume, and none of them line up with an edge.
  const bars = [
    { h: 103.37, l: 101.02, v: 1_234 },
    { h: 109.91, l: 100.04, v: 87 },
    { h: 105.5, l: 105.5, v: 999 },
    { h: 110.0, l: 109.999, v: 42 },
    { h: 100.001, l: 100.0, v: 7 },
    { h: 107.25, l: 102.75, v: 55_555 },
  ];
  const expected = 1_234 + 87 + 999 + 42 + 7 + 55_555;

  for (const bucketCount of [1, 2, 7, 50, 313]) {
    const profile = buildVolumeProfile(bars, { bucketCount });
    const summed = profile.buckets.reduce((sum, b) => sum + b.volume, 0);
    near(`total conserved at ${bucketCount} buckets`, profile.totalVolume, expected, 1e-6);
    near(`buckets sum to the total at ${bucketCount} buckets`, summed, expected, 1e-6);
    ok(
      `no negative buckets at ${bucketCount}`,
      profile.buckets.every((b) => b.volume >= 0),
    );
  }

  // The bar touching the very top of the range must land in the last bucket,
  // not in a phantom bucket past the end.
  const profile = buildVolumeProfile(bars, { bucketCount: 10 });
  ok(
    'the top-of-range bar lands inside the last bucket',
    profile.buckets[9].volume > 0,
    `got ${profile.buckets[9].volume}`,
  );
  near('range floor', profile.priceLow, 100);
  near('range ceiling', profile.priceHigh, 110);
}

// --- 5. degenerate input ------------------------------------------------------

console.log('5. Degenerate input');

{
  const empty = buildVolumeProfile([], { bucketCount: 10 });
  ok('no bars gives no buckets', empty.buckets.length === 0);
  ok('no bars gives no POC', empty.pocIndex === null);
  ok('no bars gives no value area', empty.valueArea === null);

  // Every bar at one price: one bucket, not fifty identical ones.
  const flat = buildVolumeProfile(
    [
      { h: 50, l: 50, v: 10 },
      { h: 50, l: 50, v: 30 },
    ],
    { bucketCount: 50 },
  );
  ok('a zero-width range collapses to one bucket', flat.buckets.length === 1);
  near('that bucket holds everything', flat.buckets[0].volume, 40);
  ok('POC is that bucket', flat.pocIndex === 0);
  ok('value area is that bucket', flat.valueArea.fromIndex === 0 && flat.valueArea.toIndex === 0);

  // Bars that widen the range but carry nothing: drawable, but nothing to draw.
  const silent = buildVolumeProfile([{ h: 110, l: 100, v: 0 }], { bucketCount: 10 });
  ok('a volumeless range still yields buckets', silent.buckets.length === 10);
  ok('a volumeless range has no POC', silent.pocIndex === null);
  ok('a volumeless range has no value area', silent.valueArea === null);

  // A nonsense bucket count must not throw or return an empty profile.
  const clamped = buildVolumeProfile([{ h: 110, l: 100, v: 5 }], { bucketCount: 0 });
  ok('a zero bucket count clamps to one', clamped.buckets.length === 1);
  near('and keeps the volume', clamped.totalVolume, 5);

  // Non-finite values are dropped rather than poisoning the range.
  const dirty = buildVolumeProfile(
    [
      { h: 110, l: 100, v: 100 },
      { h: NaN, l: 100, v: 100 },
      { h: 110, l: 100, v: Infinity },
    ],
    { bucketCount: 10 },
  );
  near('non-finite bars are ignored', dirty.totalVolume, 100);
}

// --- 6. the value-area share is honoured -------------------------------------

console.log('6. Value area share');

{
  const layout = [1, 2, 3, 20, 8, 7, 1, 1, 1, 1];
  const bars = [RANGE_SETTER, ...layout.map((v, i) => at(i, v))];

  // 100% has to enclose every bucket; anything less than the POC's own share
  // has to enclose exactly the POC.
  const all = buildVolumeProfile(bars, { bucketCount: 10, valueAreaShare: 1 }).valueArea;
  ok('a 100% share encloses everything', all.fromIndex === 0 && all.toIndex === 9);
  near('and its volume is the total', all.volume, 45);

  const tiny = buildVolumeProfile(bars, { bucketCount: 10, valueAreaShare: 0.1 }).valueArea;
  ok('a share below the POC stops at the POC', tiny.fromIndex === 3 && tiny.toIndex === 3);
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
