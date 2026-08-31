/*
 * Validation of the home page's combined breadth-and-VIX verdict.
 *
 * Why this file exists: this line is the only place on the site where two
 * independent readings are joined into one claim, and it sits on the front
 * door. Every other sentence describes a single measurement; this one performs
 * a small act of reasoning, which is exactly the kind of thing that acquires a
 * prediction during a later edit.
 *
 * So the checks below are less about wording and more about what the wording
 * is not allowed to become: no direction, no forecast, no advice about what to
 * buy. Every one of the nine combinations is walked, plus the three ways an
 * input can be missing.
 *
 * Run: npm run verify:context
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { contextVerdict, VIX_FLAT_PCT } = await import(
  '../src/lib/marketContext/verdict.ts'
);

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(name) {
  console.log(`\n${name}`);
}

/** One representative percentage per band, from lib/breadth/compute.ts. */
const BANDS = [
  ['weak', 22],
  ['middling', 50],
  ['broad', 78],
];

/** Comfortably outside the flat band, and comfortably inside it. */
const VIX = [
  ['rising', VIX_FLAT_PCT + 4],
  ['easing', -(VIX_FLAT_PCT + 4)],
  ['steady', 0],
];

// --- every combination produces a usable sentence ----------------------------

section('All nine combinations');

const sentences = [];

for (const [bandName, breadthPct] of BANDS) {
  for (const [moveName, vixChangePct] of VIX) {
    const line = contextVerdict({ breadthPct, vixChangePct });
    sentences.push(line);

    ok(
      `${bandName} / ${moveName} says something`,
      typeof line === 'string' && line.length > 20,
      JSON.stringify(line),
    );
    ok(
      `${bandName} / ${moveName} is a finished sentence`,
      /\.$/.test(line),
      line,
    );
    ok(
      `${bandName} / ${moveName} names the breadth reading`,
      line.toLowerCase().includes(bandName),
      line,
    );
    ok(
      `${bandName} / ${moveName} names the VIX reading`,
      line.toLowerCase().includes(moveName),
      line,
    );
  }
}

ok(
  'the nine are nine distinct sentences',
  new Set(sentences).size === 9,
  `${new Set(sentences).size} unique`,
);

// --- what none of them may say -----------------------------------------------

section('Nothing here predicts or advises');

/*
 * Two lists, because they fail differently.
 *
 * A direction word claims to know which way price goes. An advice word tells
 * the reader to act.
 *
 * "higher" and "lower" carry a lookahead, and it is not a fudge to let a
 * sentence through. Those two words do double duty in English: "moves lower"
 * is a direction claim, "lower confidence" is a statement about how much
 * weight to give a reading — which is this line's entire job. The first
 * version of this guard failed the sentence "Treat upside breaks with lower
 * confidence", which is the correct wording. Bare "higher"/"lower" still fail;
 * only the certainty nouns are exempt.
 */
const DIRECTION =
  /\b(will|should|expect|likely|target|rally|selloff|bullish|bearish)\b|\b(higher|lower)\b(?!\s+(confidence|conviction|weight))/i;
const ADVICE = /\b(buy|sell|short|long the|enter|exit|take profit)\b/i;

for (const line of sentences) {
  ok(`no direction claim: "${line.slice(0, 44)}…"`, !DIRECTION.test(line), line);
  ok(`no advice: "${line.slice(0, 44)}…"`, !ADVICE.test(line), line);
}

// --- the flat band -----------------------------------------------------------

section('Small VIX moves are called steady, not a direction');

ok(
  'just inside the band reads steady',
  contextVerdict({ breadthPct: 50, vixChangePct: VIX_FLAT_PCT - 0.01 }).includes(
    'steady',
  ),
);
ok(
  'just outside it reads rising',
  contextVerdict({ breadthPct: 50, vixChangePct: VIX_FLAT_PCT + 0.01 }).includes(
    'rising',
  ),
);
ok(
  'and the negative side reads easing',
  contextVerdict({ breadthPct: 50, vixChangePct: -(VIX_FLAT_PCT + 0.01) }).includes(
    'easing',
  ),
);

// --- missing inputs ----------------------------------------------------------

section('A missing reading is said out loud, never averaged over');

{
  const noBreadth = contextVerdict({ breadthPct: null, vixChangePct: 5 });
  ok('no breadth still returns a sentence', noBreadth.length > 20, noBreadth);
  ok(
    'and says the breadth reading is absent rather than average',
    /no breadth reading/i.test(noBreadth),
    noBreadth,
  );
  ok('and does not invent a band', !/weak|broad|middling/i.test(noBreadth), noBreadth);

  const noVix = contextVerdict({ breadthPct: 22, vixChangePct: null });
  ok('no VIX still returns a sentence', noVix.length > 20, noVix);
  ok('and says so', /no VIX quote/i.test(noVix), noVix);
  ok(
    'and does not claim a VIX direction',
    !/rising|easing|steady/i.test(noVix),
    noVix,
  );

  const neither = contextVerdict({ breadthPct: null, vixChangePct: null });
  ok('neither still returns a sentence', neither.length > 20, neither);
  ok(
    'and offers no combined read at all',
    /no combined read/i.test(neither),
    neither,
  );
}

// --- band boundaries ---------------------------------------------------------

section('Band edges land on the right side');

ok('60 is not yet broad', contextVerdict({ breadthPct: 60, vixChangePct: 0 }).includes('middling'));
ok('61 is broad', contextVerdict({ breadthPct: 61, vixChangePct: 0 }).includes('broad'));
ok('40 is not weak', contextVerdict({ breadthPct: 40, vixChangePct: 0 }).includes('middling'));
ok('39 is weak', contextVerdict({ breadthPct: 39, vixChangePct: 0 }).includes('weak'));

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
