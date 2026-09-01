/*
 * Validation of the plain status shown on the Track Record page,
 * src/lib/log/types.ts → matchStatus.
 *
 * Why this file exists: the status column is the only part of the record most
 * readers will actually read, and the failure mode is silent and flattering.
 * Score an unjudgeable day as a hit, or quietly drop a day where the flip
 * broke, and the page reports a track record the data does not support. The
 * table below is the specification, and it deliberately spends as many rows on
 * misses as on hits.
 *
 * Run: npm run verify:track-record
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { matchStatus, MATCH_LABEL, summarise } = await import('../src/lib/log/types.ts');

let failures = 0;
let checks = 0;

function eq(label, actual, expected) {
  checks += 1;
  if (actual === expected) return;
  failures += 1;
  console.error(
    `  FAIL  ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** A settled day with both claims on the board, overridden per case. */
function day(over = {}) {
  return {
    date: '2026-08-28',
    snapshotAt: '2026-08-28T13:45:00.000Z',
    regime: 'positive',
    flipLevel: 640,
    spotAtSnapshot: 645,
    magnetAbove: 650,
    magnetBelow: 630,
    netGex: 1e9,
    settled: true,
    flipOutcome: 'held',
    magnetTouched: 'above',
    ...over,
  };
}

console.log('Track record status');

// --- both claims judged ----------------------------------------------------
eq('flip held + magnet touched', matchStatus(day()), 'mostly');
eq(
  'flip held + magnet missed',
  matchStatus(day({ magnetTouched: 'none' })),
  'partially',
);
eq(
  'flip broke + magnet touched',
  matchStatus(day({ flipOutcome: 'broke' })),
  'partially',
);
eq(
  'flip broke + magnet missed',
  matchStatus(day({ flipOutcome: 'broke', magnetTouched: 'none' })),
  'none',
);

// --- one claim only --------------------------------------------------------
// No flip level was recorded, so the day is scored on the magnet alone rather
// than being half-credited for a claim nobody made.
eq(
  'no flip level, magnet touched',
  matchStatus(day({ flipLevel: null, flipOutcome: 'na' })),
  'mostly',
);
eq(
  'no flip level, magnet missed',
  matchStatus(day({ flipLevel: null, flipOutcome: 'na', magnetTouched: 'none' })),
  'none',
);
eq(
  'no magnets, flip held',
  matchStatus(day({ magnetAbove: null, magnetBelow: null })),
  'mostly',
);
eq(
  'no magnets, flip broke',
  matchStatus(day({ magnetAbove: null, magnetBelow: null, flipOutcome: 'broke' })),
  'none',
);

// --- nothing to judge ------------------------------------------------------
// null, never 'none'. An unsettled or unjudgeable day is not a miss, and
// scoring it as one would misreport the record in the reader's favour or
// against it depending on the day.
eq('unsettled day', matchStatus(day({ settled: false })), null);
eq(
  'settled but nothing recorded',
  matchStatus(
    day({ flipLevel: null, flipOutcome: 'na', magnetAbove: null, magnetBelow: null }),
  ),
  null,
);

// --- the labels the page prints -------------------------------------------
eq('label mostly', MATCH_LABEL.mostly, 'Mostly matched');
eq('label partially', MATCH_LABEL.partially, 'Partially matched');
eq('label none', MATCH_LABEL.none, 'Did not match');

// --- misses stay in the count ---------------------------------------------
// The headline stats are the other place a miss could quietly vanish.
const mixed = [
  day({ date: '2026-08-25', flipOutcome: 'broke', magnetTouched: 'none' }),
  day({ date: '2026-08-26' }),
  day({ date: '2026-08-27', flipOutcome: 'broke' }),
];
const stats = summarise(mixed);
eq('all three days judged on the flip', stats.flipJudged, 3);
eq('only the one held day counts as held', stats.flipHeld, 1);
eq('flip held percentage reports the misses', Math.round(stats.flipHeldPct), 33);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
