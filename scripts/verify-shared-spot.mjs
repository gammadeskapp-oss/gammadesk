/*
 * One shared spot everywhere.
 *
 * The /decision top box, the level map, the walls, the conviction check, the
 * dashboard strip and the X posts must all quote the SAME price — the fresh
 * shared spot — while which strikes are walls stays classified off the stable
 * chain spot. This is the regression guard for that split: the level map's
 * marker and every "from spot" distance must be anchored to the reference spot
 * it is handed, NOT to the chain spot used to pick the walls.
 *
 * Also covers the ordinal fix (no more "3th touch").
 *
 * Run: npm run verify:shared-spot
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { buildLevelMap } = await import('../src/lib/decision/levelMap.ts');
const { ordinalOf } = await import('../src/lib/ordinal.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}
function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function close(label, actual, expected, tol = 1e-9) {
  ok(label, Math.abs(actual - expected) <= tol, `expected ~${expected}, got ${actual}`);
}
function section(name) {
  console.log(`\n${name}`);
}

// A small synthetic chain around a chain spot of 767.68, with the shared live
// spot 763.96 (the two values the user reported out of sync).
const CHAIN_SPOT = 767.68;
const REF_SPOT = 763.96;
const rows = [
  { strike: 760, gex: -3e9 },
  { strike: 765, gex: -5e9 },
  { strike: 767, gex: -10e9 },
  { strike: 769, gex: 6e9 },
  { strike: 770, gex: 4e9 },
];
const summary = { netGex: -3e9, flipLevel: 769.74, frontFlipLevel: 768.14 };

section('The level map is anchored to the reference spot, not the chain spot');
{
  const map = buildLevelMap(rows, CHAIN_SPOT, summary, REF_SPOT);
  eq('LevelMap.spot is the reference (live) spot', map.spot, REF_SPOT);

  const spotRung = map.rungs.find((r) => r.isSpot);
  ok('there is a SPOT rung', Boolean(spotRung));
  eq('the SPOT rung sits at the reference spot', spotRung?.price, REF_SPOT);
  close('the SPOT rung reads 0% from spot', spotRung?.distancePct ?? NaN, 0);

  // Every rung's distance back-solves to the reference spot, never the chain.
  for (const r of map.rungs) {
    const implied = r.price / (1 + r.distancePct / 100);
    close(`rung ${r.price} distance is measured from the reference spot`, implied, REF_SPOT, 1e-6);
  }
}

section('Display spot is decoupled from the chain spot used for classification');
{
  // Same reference spot, two very different chain spots -> identical displayed
  // spot and identical distances. If the display ever leaked the chain spot,
  // these would diverge.
  const a = buildLevelMap(rows, 760, summary, REF_SPOT);
  const b = buildLevelMap(rows, 775, summary, REF_SPOT);
  eq('displayed spot is independent of chain spot', a.spot, b.spot);
  const da = a.rungs.find((r) => r.price === 769)?.distancePct;
  const db = b.rungs.find((r) => r.price === 769)?.distancePct;
  eq('the 769 rung distance is independent of chain spot', da, db);
}

section('Default reference spot falls back to the chain spot');
{
  const map = buildLevelMap(rows, CHAIN_SPOT, summary);
  eq('omitting the reference spot uses the chain spot', map.spot, CHAIN_SPOT);
}

section('Ordinals read correctly (no more "3th")');
{
  const cases = [
    [0, '0th'], [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [5, '5th'],
    [10, '10th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'],
    [22, '22nd'], [23, '23rd'], [111, '111th'], [101, '101st'],
  ];
  for (const [n, want] of cases) eq(`ordinalOf(${n})`, ordinalOf(n), want);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
