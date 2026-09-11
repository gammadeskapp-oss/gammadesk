/*
 * Validation of the chart's New York time conversion, in src/lib/bars/etTime.ts.
 *
 * Why this file exists: lightweight-charts formats every timestamp in UTC, so
 * the /decision chart's axis and crosshair read one zone while the "last bar"
 * footer and the context band read New York. The fix shifts each bar's stamp by
 * New York's offset before it reaches the library, so the UTC value it prints
 * already carries the New York wall clock. The offset changes twice a year, and
 * a bar rendered an hour wrong across a DST boundary is exactly the kind of
 * thing that renders plausibly and is only caught by asserting a known instant.
 *
 * So every case below is a UTC instant whose New York label is known by hand,
 * spanning both offsets and both DST switchover days, and asserts the shifted
 * stamp — formatted back in UTC, the way the axis formats it — reads that label.
 *
 * Run: npm run verify:et-time
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { toEtChartTime, newYorkOffsetSeconds } = await import(
  '../src/lib/bars/etTime.ts'
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

const HOUR = 3600;

/** Epoch seconds for a UTC wall-clock instant. */
function utc(y, m, d, hh, mm) {
  return Date.UTC(y, m - 1, d, hh, mm, 0) / 1000;
}

/**
 * The `HH:mm` an axis would print for a bar — i.e. the shifted stamp read back
 * in UTC, which is precisely how lightweight-charts formats it. This is the
 * "label" the chart shows; asserting it is asserting what the reader sees.
 */
function axisLabel(epochSeconds) {
  const d = new Date(toEtChartTime(epochSeconds) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// --- the offset itself, on each side of the year -----------------------------

section('New York offset is −5h under EST and −4h under EDT');

ok(
  'a January instant is five hours behind UTC',
  newYorkOffsetSeconds(utc(2025, 1, 15, 14, 30)) === -5 * HOUR,
  `${newYorkOffsetSeconds(utc(2025, 1, 15, 14, 30)) / HOUR}h`,
);
ok(
  'a July instant is four hours behind UTC',
  newYorkOffsetSeconds(utc(2025, 7, 15, 13, 30)) === -4 * HOUR,
  `${newYorkOffsetSeconds(utc(2025, 7, 15, 13, 30)) / HOUR}h`,
);

// --- a known UTC bar renders at its correct ET label -------------------------

section('A known UTC bar renders at its New York label');

// 14:30 UTC in January is the 09:30 opening bell under EST.
ok('winter 14:30 UTC reads 09:30 ET', axisLabel(utc(2025, 1, 15, 14, 30)) === '09:30', axisLabel(utc(2025, 1, 15, 14, 30)));
// 13:30 UTC in July is the same 09:30 bell under EDT — a different UTC hour, the
// same New York label, which is the whole point of resolving the offset per bar.
ok('summer 13:30 UTC reads 09:30 ET', axisLabel(utc(2025, 7, 15, 13, 30)) === '09:30', axisLabel(utc(2025, 7, 15, 13, 30)));
// The last-bar case that first exposed the bug: 18:49 UTC in September read as
// 18:49 on the axis while the footer said 14:49 ET.
ok('a September 18:49 UTC bar reads 14:49 ET', axisLabel(utc(2025, 9, 11, 18, 49)) === '14:49', axisLabel(utc(2025, 9, 11, 18, 49)));

// --- across a DST boundary ---------------------------------------------------

section('The label is right on both sides of a DST switchover');

// Spring forward: 2025-03-09, clocks jump 02:00 EST -> 03:00 EDT at 07:00 UTC.
ok(
  'before the spring switch, 06:30 UTC reads 01:30 ET (EST)',
  axisLabel(utc(2025, 3, 9, 6, 30)) === '01:30',
  axisLabel(utc(2025, 3, 9, 6, 30)),
);
ok(
  'after the spring switch, 13:30 UTC reads 09:30 ET (EDT)',
  axisLabel(utc(2025, 3, 9, 13, 30)) === '09:30',
  axisLabel(utc(2025, 3, 9, 13, 30)),
);

// Fall back: 2025-11-02, clocks drop 02:00 EDT -> 01:00 EST at 06:00 UTC.
ok(
  'before the autumn switch, 05:30 UTC reads 01:30 ET (EDT)',
  axisLabel(utc(2025, 11, 2, 5, 30)) === '01:30',
  axisLabel(utc(2025, 11, 2, 5, 30)),
);
ok(
  'after the autumn switch, 14:30 UTC reads 09:30 ET (EST)',
  axisLabel(utc(2025, 11, 2, 14, 30)) === '09:30',
  axisLabel(utc(2025, 11, 2, 14, 30)),
);

// A pair of regular-hours bars either side of the spring boundary must stay in
// order after shifting — the library rejects a non-ascending series, and the
// conversion must not manufacture one.
ok(
  'shifting preserves ascending order across the boundary',
  toEtChartTime(utc(2025, 3, 9, 13, 30)) > toEtChartTime(utc(2025, 3, 9, 6, 30)),
  `${toEtChartTime(utc(2025, 3, 9, 6, 30))} -> ${toEtChartTime(utc(2025, 3, 9, 13, 30))}`,
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
