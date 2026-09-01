/*
 * Validation of the one research line under the front-door verdict.
 *
 * Why this file exists: this sentence sits directly beneath the largest claim
 * on the site, in exactly the spot a reader looks for "so what do I do". Every
 * other sentence in the app describes a measurement. This one gives an
 * instruction, and the only thing keeping it safe is that the instruction is
 * always about *research* — how carefully to read, what would have to happen
 * first — and never about a position.
 *
 * So the checks below are mostly about what the wording is not allowed to
 * become. All eight combinations are walked, plus the mood/breadth pairing
 * itself, because a line that reasons about a calm day under a "Wild" headline
 * would be worse than no line at all.
 *
 * Run: npm run verify:research
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { researchLine } = await import('../src/lib/simple/research.ts');
const { moodOf } = await import('../src/lib/simple/translate.ts');

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
  ['missing', null],
];

const MOODS = ['calm', 'wild'];

// --- every combination produces a usable line --------------------------------

section('All eight combinations');

const lines = [];

for (const mood of MOODS) {
  for (const [bandName, breadthPct] of BANDS) {
    const line = researchLine({ mood, breadthPct });
    const label = `${mood} / ${bandName} breadth`;

    ok(`${label} returns a sentence`, line.length > 30, line);
    ok(`${label} ends in a full stop`, line.trim().endsWith('.'), line);
    ok(
      `${label} names the day it belongs to`,
      new RegExp(mood, 'i').test(line),
      line,
    );
    lines.push([label, line]);
  }
}

ok(
  'all eight are distinct',
  new Set(lines.map(([, line]) => line)).size === lines.length,
);

// --- nothing here may become a trade instruction -----------------------------

section('No line tells anyone to take a position');

/*
 * Whole words only. "sell" as a substring would hit nothing today, but
 * "position" would fire on "positioning", which is the app's own subject —
 * banning it as a substring would ban the vocabulary rather than the advice.
 */
const FORBIDDEN = [
  /\bbuy(ing|s)?\b/i,
  /\bsell(ing|s)?\b/i,
  /\bshort(ing|s)?\b/i,
  /\blong\b/i,
  /\bcalls?\b/i,
  /\bputs?\b/i,
  /\bstrike\b/i,
  /\bentry\b/i,
  /\bexit\b/i,
  /\bstop[- ]loss\b/i,
  /\btarget\b/i,
  /\bposition size\b/i,
  /\btrade\b/i,
];

for (const [label, line] of lines) {
  for (const pattern of FORBIDDEN) {
    ok(`${label} avoids ${pattern}`, !pattern.test(line), line);
  }
}

// --- nor a forecast ----------------------------------------------------------

section('No line predicts a direction');

const PREDICTIVE = [
  /\bwill\b/i,
  /\bexpect(ed|s)?\b/i,
  /\bshould (rise|fall|go|head)\b/i,
  /\brally\b/i,
  /\bcrash\b/i,
  /\bbullish\b/i,
  /\bbearish\b/i,
];

for (const [label, line] of lines) {
  for (const pattern of PREDICTIVE) {
    ok(`${label} avoids ${pattern}`, !pattern.test(line), line);
  }
}

// --- the mood it is keyed on is the one the headline shows -------------------

section('Mood agrees with the headline above it');

/*
 * The headline says Calm or Wild based on `moodOf`. If the research line were
 * keyed on the raw gamma sign instead, a positive-gamma day under its flip
 * would print "Wild" in large type with a calm-day instruction beneath it.
 */
const underFlip = { regime: 'positive', aboveFlip: false };
ok(
  'positive gamma under the flip is wild to both',
  moodOf(underFlip) === 'wild',
);
ok(
  'and the line written for it says so',
  /wild/i.test(researchLine({ mood: moodOf(underFlip), breadthPct: 22 })),
);

// --- band edges land on the right side ---------------------------------------

section('Band edges match the breadth thresholds');

ok(
  '60 is not yet broad',
  researchLine({ mood: 'calm', breadthPct: 60 }) ===
    researchLine({ mood: 'calm', breadthPct: 50 }),
);
ok(
  '61 is broad',
  researchLine({ mood: 'calm', breadthPct: 61 }) ===
    researchLine({ mood: 'calm', breadthPct: 78 }),
);
ok(
  '40 is not weak',
  researchLine({ mood: 'calm', breadthPct: 40 }) ===
    researchLine({ mood: 'calm', breadthPct: 50 }),
);
ok(
  '39 is weak',
  researchLine({ mood: 'calm', breadthPct: 39 }) ===
    researchLine({ mood: 'calm', breadthPct: 22 }),
);

// --- a missing reading is said, not averaged ---------------------------------

section('A missing breadth reading is stated');

for (const mood of MOODS) {
  const line = researchLine({ mood, breadthPct: null });
  ok(
    `${mood} with no breadth says so`,
    /no breadth reading/i.test(line),
    line,
  );
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
