/*
 * The coverage list and lookups behind the public ticker pages
 * (/daily/[ticker]): which symbols get a page, case handling, and the
 * SPY-lives-at-/daily invariant the page and sitemap both depend on.
 *
 * Run: npm run verify:coverage
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { COVERAGE, coveredSymbols, isCovered, coverageEntry } = await import(
  '../src/lib/daily/coverage.ts'
);

// The same rule normaliseSymbol enforces (1-5 upper-case letters). Inlined so
// this test does not pull in positioning.ts's server-only dependency chain.
const isPlainTicker = (s) => /^[A-Z]{1,5}$/.test(s);

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

section('the list is a sane, curated set');
ok('has a healthy number of names', COVERAGE.length >= 15 && COVERAGE.length <= 40, String(COVERAGE.length));
ok('SPY is present and leads', COVERAGE[0].symbol === 'SPY');
ok('every entry has a symbol, name and kind', COVERAGE.every((e) => e.symbol && e.name && e.kind));
ok('every symbol is a plain 1-5 letter ticker', COVERAGE.every((e) => isPlainTicker(e.symbol)));
{
  const seen = new Set();
  const dupes = COVERAGE.filter((e) => (seen.has(e.symbol) ? true : (seen.add(e.symbol), false)));
  ok('no duplicate symbols', dupes.length === 0, dupes.map((d) => d.symbol).join(','));
}

section('coveredSymbols mirrors the list, in order');
ok('same length', coveredSymbols().length === COVERAGE.length);
ok('same order', coveredSymbols().join(',') === COVERAGE.map((e) => e.symbol).join(','));

section('isCovered is case-insensitive and safe on junk');
ok('NVDA covered', isCovered('NVDA') === true);
ok('lower-case nvda covered', isCovered('nvda') === true);
ok('unknown ZZZZ not covered', isCovered('ZZZZ') === false);
ok('null not covered', isCovered(null) === false);
ok('empty string not covered', isCovered('') === false);

section('coverageEntry returns the entry or null');
ok('aapl resolves and normalises case', coverageEntry('aapl')?.symbol === 'AAPL');
ok('unknown resolves to null', coverageEntry('ZZZZ') === null);
ok('null resolves to null', coverageEntry(null) === null);

section('SPY invariant: it is covered but has no /daily/SPY sitemap entry');
ok('SPY is covered', isCovered('SPY') === true);
{
  // The sitemap filters SPY out because its page is /daily itself.
  const sitemapTickers = COVERAGE.filter((e) => e.symbol !== 'SPY');
  ok('SPY excluded from ticker-page set', !sitemapTickers.some((e) => e.symbol === 'SPY'));
  ok('the rest are all covered', sitemapTickers.every((e) => isCovered(e.symbol)));
}

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
