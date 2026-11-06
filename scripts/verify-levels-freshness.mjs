/*
 * Validation of the Home levels staleness rule in
 * src/lib/redesign/levelsFreshness.ts.
 *
 * The rule decides whether the public Home may print its saved flip and
 * magnets beside a live spot. Too loose and a stalled cron shows hours-old
 * levels as current (the failure this exists for); too tight and every normal
 * five-minute cadence, or Polygon's 15-minute plan delay, would blank the
 * hero. Each row is a moment and the verdict it deserves.
 *
 * Run: npm run verify:levels-freshness
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { assessLevelsFreshness, BUILT_MAX_AGE_MIN, QUOTE_MAX_AGE_MIN } = await import(
  '../src/lib/redesign/levelsFreshness.ts'
);

const now = new Date('2026-11-05T19:00:00Z'); // 14:00 ET, in session
const ago = (min) => new Date(now.getTime() - min * 60_000).toISOString();

const cases = [
  ['normal cadence: built 4 min ago, data 17 min old', { builtAtIso: ago(4), quoteDateIso: ago(17), marketOpen: true }, false],
  ['at the build limit exactly', { builtAtIso: ago(BUILT_MAX_AGE_MIN), quoteDateIso: ago(17), marketOpen: true }, false],
  ['cron stalled: built 21 min ago', { builtAtIso: ago(BUILT_MAX_AGE_MIN + 1), quoteDateIso: ago(17), marketOpen: true }, true],
  ['cron dead for hours', { builtAtIso: ago(180), quoteDateIso: ago(195), marketOpen: true }, true],
  ['upstream frozen: fresh build, 41-min-old data', { builtAtIso: ago(3), quoteDateIso: ago(QUOTE_MAX_AGE_MIN + 1), marketOpen: true }, true],
  ['at the data limit exactly', { builtAtIso: ago(3), quoteDateIso: ago(QUOTE_MAX_AGE_MIN), marketOpen: true }, false],
  ['missing build time in session', { builtAtIso: null, quoteDateIso: ago(10), marketOpen: true }, true],
  ['garbage build time in session', { builtAtIso: 'not-a-date', quoteDateIso: ago(10), marketOpen: true }, true],
  ['missing data time in session', { builtAtIso: ago(3), quoteDateIso: undefined, marketOpen: true }, true],
  ['after the close: last snapshot is the answer', { builtAtIso: ago(300), quoteDateIso: ago(310), marketOpen: false }, false],
  ['weekend with no timestamps', { builtAtIso: null, quoteDateIso: null, marketOpen: false }, false],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const got = assessLevelsFreshness({ ...input, now });
  const ok = got.stale === expected && (got.stale ? typeof got.reason === 'string' : got.reason === null);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} -> stale=${got.stale}${got.reason ? ` (${got.reason})` : ''}`);
}

const ages = assessLevelsFreshness({ builtAtIso: ago(7), quoteDateIso: ago(22), marketOpen: true, now });
if (ages.builtAgeMin !== 7 || ages.quoteAgeMin !== 22) {
  failed += 1;
  console.log(`FAIL  ages reported ${ages.builtAgeMin}/${ages.quoteAgeMin}, expected 7/22`);
} else {
  console.log('PASS  ages are reported in whole minutes');
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length + 1} levels-freshness checks passed.`);
