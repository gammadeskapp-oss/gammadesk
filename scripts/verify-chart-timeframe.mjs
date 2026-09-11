/*
 * Validation of the chart's default-timeframe rule, in src/lib/bars/types.ts.
 *
 * Why this file exists: the chart opens on a timeframe, and the requirement is
 * a two-line contract that is easy to get backwards — a reader who has chosen a
 * timeframe keeps it across reloads, and a reader who never has lands on the
 * 15-minute default rather than on 5m or on whatever was last written. The bug
 * this guards against is the default winning over a real stored choice, or a
 * stale/blank value winning over the default; both render a plausible chart.
 *
 * `resolveTimeframe` is the pure heart of that rule, lifted out of the
 * `localStorage` read precisely so it can be pinned here without a DOM.
 *
 * Run: npm run verify:chart-timeframe
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { resolveTimeframe, DEFAULT_TIMEFRAME, isTimeframe, TIMEFRAMES } =
  await import('../src/lib/bars/types.ts');

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

// --- the default itself ------------------------------------------------------

section('The default timeframe is 15m');

ok('the shared default is 15m', DEFAULT_TIMEFRAME === '15m', DEFAULT_TIMEFRAME);
ok('15m is a real timeframe', isTimeframe(DEFAULT_TIMEFRAME));

// --- a reader who has never chosen -------------------------------------------

section('No stored choice falls to the default');

for (const empty of [null, undefined, '']) {
  ok(
    `a ${JSON.stringify(empty)} stored value yields the default`,
    resolveTimeframe(empty) === '15m',
    resolveTimeframe(empty),
  );
}
ok(
  'a garbage stored value yields the default, not a broken timeframe',
  resolveTimeframe('9x') === '15m',
  resolveTimeframe('9x'),
);
ok(
  'a value that is not even a string falls to the default',
  resolveTimeframe(5) === '15m',
  String(resolveTimeframe(5)),
);

// --- a reader who has chosen -------------------------------------------------

section('A persisted choice is honoured, read before the default is applied');

for (const tf of TIMEFRAMES) {
  ok(`a stored ${tf} is kept`, resolveTimeframe(tf) === tf, resolveTimeframe(tf));
}
ok(
  'a stored 5m is kept rather than being reset to the default',
  resolveTimeframe('5m') === '5m',
  resolveTimeframe('5m'),
);

// --- an explicit fallback still loses to a real choice -----------------------

section('An explicit fallback fills in only when there is no choice');

ok(
  'the fallback argument is used when nothing is stored',
  resolveTimeframe(null, '1h') === '1h',
  resolveTimeframe(null, '1h'),
);
ok(
  'a real stored choice still beats an explicit fallback',
  resolveTimeframe('4h', '1h') === '4h',
  resolveTimeframe('4h', '1h'),
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
