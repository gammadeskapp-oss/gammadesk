/*
 * Validation of the level map in src/lib/decision/levelMap.ts.
 *
 * The module is imported and is the subject — Node 22.6+ strips the types.
 * The fixture is hand-built so every expected answer is worked out on paper
 * first and written down as a literal, rather than being whatever the
 * implementation happened to return.
 *
 * The technique: strike gammas are chosen so the neighbourhood's biggest is an
 * exact round number, which puts the 40% bar at another round number and makes
 * "clears the bar" a decision that can be checked by eye. The two sides are
 * given different biggest-values so a bar accidentally computed across both
 * sides at once would move which strikes qualify.
 *
 * What this exists to catch, all of which render as a plausible ladder rather
 * than as an obvious break:
 *
 *   1. A level appearing twice. The heaviest strike on the chain is very often
 *      also the floor or the ceiling, and a keyed merge that missed would put
 *      the same price on two rungs with one label each — which reads as two
 *      levels a trader would size against separately.
 *
 *   2. The map and the ceiling/floor disagreeing about what a wall is. They
 *      are separate code paths over the same rule; if the map's bar drifts
 *      from `nearestStrongWall`'s, the ladder shows a CEILING badge on a
 *      strike it does not also call a WALL, or vice versa.
 *
 *   3. The front-week flip being suppressed when it disagrees, or drawn when
 *      it does not. Both failures are silent: a missing rung looks like
 *      agreement between the near expiry and the full chain, and a spurious
 *      one invents a disagreement. The threshold is relative to spot, so a
 *      version that compared raw dollars would behave differently on a $5
 *      name and a $600 one and look correct on whichever was tested.
 *
 *   4. Gamma of zero where there is none. The flips are solved positions on a
 *      curve, not strikes; printing $0 there claims the level was measured and
 *      found empty, which is a different and false statement from "no figure
 *      applies".
 *
 *   5. Spot losing its own rung when it lands exactly on a strike. The lower
 *      side of the wall test is inclusive, so this is reachable, and the
 *      result is a ladder with no current price marked on it.
 *
 * Run: npm run verify:levelmap
 */

import { registerTsImports } from './ts-imports.mjs';

// `levelMap.ts` imports the shared wall rule by value, so the resolver needs
// to be taught the extension before the module is pulled in.
registerTsImports();
const { buildLevelMap } = await import('../src/lib/decision/levelMap.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}`);
  if (detail !== undefined) console.error(`        ${detail}`);
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${expected}, got ${actual}`);
}

function near(label, actual, expected, tol = 1e-9) {
  ok(
    label,
    Math.abs(actual - expected) <= tol,
    `expected ~${expected}, got ${actual}`,
  );
}

/*
 * The fixture.
 *
 * Spot is 100. Above it the eight nearest strikes peak at 100 (strike 102), so
 * the 40% bar sits at 40 and only 102 and 105 clear it. Below, the eight
 * nearest peak at 200 (strike 99), so that bar sits at 80 and only 99 clears
 * it. The two bars differ on purpose: a bar computed over both sides together
 * would be 200 everywhere and would drop 102 and 105 from the ladder.
 *
 * Strike 99 is also the largest absolute gamma anywhere on the chain, so it
 * has to come back as FLOOR and HEAVIEST on one rung.
 */
const SPOT = 100;
const ROWS = [
  { strike: 108, gex: 5 },
  { strike: 107, gex: 5 },
  { strike: 106, gex: 5 },
  { strike: 105, gex: 50 },
  { strike: 104, gex: 5 },
  { strike: 103, gex: 20 },
  { strike: 102, gex: 100 },
  { strike: 101, gex: 10 },
  { strike: 100, gex: -10 },
  { strike: 99, gex: -200 },
  { strike: 98, gex: -30 },
  { strike: 97, gex: -5 },
  { strike: 96, gex: -5 },
  { strike: 95, gex: -5 },
  { strike: 94, gex: -5 },
  { strike: 93, gex: -5 },
];

const labelsAt = (map, price) => {
  const rung = map.rungs.find((r) => r.price === price);
  return rung ? rung.labels.join(',') : '(no rung)';
};

console.log('\nlevel map\n');

// --- the walls the rule selects, and the labels they carry -----------------
{
  const map = buildLevelMap(ROWS, SPOT, {
    netGex: 1234,
    flipLevel: 98.5,
    frontFlipLevel: null,
  });

  // Above: biggest is 100 at strike 102, so the bar is 40. 103 carries 20 and
  // 101 carries 10 — both real gamma, neither a wall.
  eq('102 is the ceiling and a wall', labelsAt(map, 102), 'ceiling,wall');
  eq('105 clears the bar on its own', labelsAt(map, 105), 'wall');
  eq('103 is under the bar', labelsAt(map, 103), '(no rung)');
  eq('101 is under the bar', labelsAt(map, 101), '(no rung)');

  // Below: biggest is 200 at strike 99, so the bar is 80. 98 carries 30.
  eq('99 merges floor, heaviest and wall', labelsAt(map, 99), 'heaviest,floor,wall');
  eq('98 is under the bar', labelsAt(map, 98), '(no rung)');

  // One rung per price, not one per label.
  const prices = map.rungs.map((r) => r.price);
  eq('no price appears twice', new Set(prices).size, prices.length);

  // The ladder reads top down.
  ok(
    'rungs are ordered highest first',
    prices.every((p, i) => i === 0 || prices[i - 1] > p),
    prices.join(' > '),
  );

  eq('spot is its own rung', labelsAt(map, SPOT), 'spot');
  ok(
    'spot rung is flagged',
    map.rungs.find((r) => r.price === SPOT).isSpot === true,
  );
  eq(
    'exactly one rung is spot',
    map.rungs.filter((r) => r.isSpot).length,
    1,
  );

  // 105, 102, spot, 99, flip.
  eq('rung count', map.rungs.length, 5);
  eq('level count excludes spot', map.levelCount, 4);
  eq('net gamma is carried through', map.netGex, 1234);

  // The flip is not a strike, so it reports no gamma at all — distinct from
  // reporting zero.
  const flip = map.rungs.find((r) => r.labels.includes('flip'));
  ok('the flip rung exists', flip !== undefined);
  eq('the flip carries no gamma figure', flip.gex, null);
  eq('the spot rung carries no gamma figure', map.rungs.find((r) => r.isSpot).gex, null);

  // Strikes keep their sign, which is what colours the column.
  eq('a wall keeps its gamma', map.rungs.find((r) => r.price === 102).gex, 100);
  eq('a negative wall stays negative', map.rungs.find((r) => r.price === 99).gex, -200);

  // True distance, signed, and zero at spot.
  near('105 is +5% from spot', map.rungs.find((r) => r.price === 105).distancePct, 5);
  near('99 is -1% from spot', map.rungs.find((r) => r.price === 99).distancePct, -1);
  near('spot is 0% from itself', map.rungs.find((r) => r.isSpot).distancePct, 0);

  // The rule the card quotes has to be the rule that ran.
  eq('threshold is reported', map.rule.threshold, 0.4);
  eq('neighbourhood is reported', map.rule.neighbourhood, 8);
}

// --- the front-week flip, which only earns a rung when it disagrees ---------
{
  // 0.05 away on a 100 spot is 0.05% — inside the tolerance, so this is the
  // same crossing solved twice, not two levels.
  const agreeing = buildLevelMap(ROWS, SPOT, {
    netGex: 0,
    flipLevel: 98.5,
    frontFlipLevel: 98.45,
  });
  eq(
    'an agreeing front week gets no rung',
    agreeing.rungs.filter((r) => r.labels.includes('frontFlip')).length,
    0,
  );

  // 1.5 away is 1.5% — a real disagreement about where the book flips.
  const diverging = buildLevelMap(ROWS, SPOT, {
    netGex: 0,
    flipLevel: 98.5,
    frontFlipLevel: 97,
  });
  eq('a diverging front week gets its own rung', labelsAt(diverging, 97), 'frontFlip');
  eq(
    'the full-chain flip is still there',
    labelsAt(diverging, 98.5),
    'flip',
  );
  eq(
    'the front-week rung carries no gamma figure',
    diverging.rungs.find((r) => r.price === 97).gex,
    null,
  );

  // The tolerance is a share of spot, not a dollar amount. The same 0.05 gap
  // that agreed at spot 100 is a 5% disagreement at spot 1.
  const cheap = buildLevelMap(
    [
      { strike: 1.1, gex: 100 },
      { strike: 0.9, gex: -100 },
    ],
    1,
    { netGex: 0, flipLevel: 0.95, frontFlipLevel: 0.9 },
  );
  eq(
    'the tolerance scales with price',
    cheap.rungs.filter((r) => r.labels.includes('frontFlip')).length,
    1,
  );

  // No flip at all is a normal outcome — the book need not cross zero nearby.
  const noFlip = buildLevelMap(ROWS, SPOT, {
    netGex: 0,
    flipLevel: null,
    frontFlipLevel: null,
  });
  eq(
    'a book with no crossing has no flip rung',
    noFlip.rungs.filter((r) => r.labels.includes('flip')).length,
    0,
  );

  // A front week that crosses where the full chain does not still deserves the
  // rung — there is nothing to be redundant with.
  const frontOnly = buildLevelMap(ROWS, SPOT, {
    netGex: 0,
    flipLevel: null,
    frontFlipLevel: 97,
  });
  eq('a lone front-week flip is drawn', labelsAt(frontOnly, 97), 'frontFlip');
}

// --- spot landing exactly on a strike --------------------------------------
{
  // The lower side of the wall test is inclusive, so spot can be a wall. The
  // rung has to carry both labels and still render as spot.
  const rows = [
    { strike: 102, gex: 100 },
    { strike: 100, gex: -200 },
    { strike: 98, gex: -20 },
  ];
  const map = buildLevelMap(rows, 100, {
    netGex: 0,
    flipLevel: null,
    frontFlipLevel: null,
  });

  const rung = map.rungs.find((r) => r.price === 100);
  ok('spot-on-a-strike keeps its rung', rung !== undefined);
  ok('spot-on-a-strike is still flagged as spot', rung.isSpot === true);
  ok('spot-on-a-strike keeps the strike labels', rung.labels.includes('floor'));
  ok('spot-on-a-strike keeps its gamma', rung.gex === -200);
  eq('still exactly one spot rung', map.rungs.filter((r) => r.isSpot).length, 1);
}

// --- degenerate chains ------------------------------------------------------
{
  const empty = buildLevelMap([], 100, {
    netGex: 0,
    flipLevel: null,
    frontFlipLevel: null,
  });
  eq('an empty chain still shows spot', empty.rungs.length, 1);
  eq('an empty chain has no levels', empty.levelCount, 0);

  // Zero and non-finite gamma are not levels.
  const junk = buildLevelMap(
    [
      { strike: 105, gex: 0 },
      { strike: 95, gex: Number.NaN },
      { strike: 90, gex: Number.POSITIVE_INFINITY },
    ],
    100,
    { netGex: 0, flipLevel: null, frontFlipLevel: null },
  );
  eq('empty and broken strikes are dropped', junk.levelCount, 0);
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
