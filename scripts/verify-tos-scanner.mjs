/*
 * Validation of the TOS Scanner's subject parser, in src/lib/tos/parse.ts.
 *
 * Why this file exists: the whole feature hinges on reading one line of English
 * out of an email subject. thinkorswim's wording is not fixed — was/were,
 * added to/removed from, symbol/symbols, tickers with dots and slashes, a
 * trailing period — and a parser that quietly mishandles one variant would add
 * the wrong ticker to a list a person then trades from, or silently drop a real
 * change. The two failure modes that matter are asserted directly:
 *
 *   1. A real Trend alert is parsed into the right action and the right
 *      symbols, across every wording variant.
 *   2. An alert for another scan, and a subject that is not an alert at all,
 *      are BOTH rejected — but for different reasons. Another scan is a clean
 *      "ignore"; junk is an "unrecognised" the poller logs so the format can be
 *      checked. Conflating the two would either spam the log or hide a wording
 *      change.
 *
 * Run: npm run verify:tos-scanner
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { parseAlertSubject, parseTrendAlert, isTrendScan, applyTrendChange } =
  await import('../src/lib/tos/parse.ts');

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

/** Deep-ish equality good enough for the small shapes here. */
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- symbols added -----------------------------------------------------------

section('A "new symbols … were added to Trend" alert');

{
  const r = parseAlertSubject('Alert: New symbols: BBWI, MRNA, TEM were added to Trend.');
  ok('parses at all', r !== null);
  ok('action is added', r?.action === 'added', r?.action);
  ok('scan is Trend', r?.scan === 'Trend', r?.scan);
  ok('all three symbols, uppercased', eq(r?.symbols, ['BBWI', 'MRNA', 'TEM']), JSON.stringify(r?.symbols));
}

// --- symbols removed ---------------------------------------------------------

section('A "symbols … were removed from Trend" alert');

{
  const r = parseAlertSubject('Alert: Symbols: XYZ were removed from Trend.');
  ok('action is removed', r?.action === 'removed', r?.action);
  ok('scan is Trend', r?.scan === 'Trend', r?.scan);
  ok('the one symbol', eq(r?.symbols, ['XYZ']), JSON.stringify(r?.symbols));
}

// --- a single symbol, singular wording --------------------------------------

section('Singular "symbol … was added"');

{
  const r = parseAlertSubject('Alert: New symbol: AAPL was added to Trend.');
  ok('action is added', r?.action === 'added', r?.action);
  ok('one symbol', eq(r?.symbols, ['AAPL']), JSON.stringify(r?.symbols));
}

// --- tickers with dots and slashes, no trailing period -----------------------

section('Dotted and slashed tickers, no trailing period');

{
  const r = parseAlertSubject('Alert: New symbols: BRK.B, /ES were added to Trend');
  ok('keeps BRK.B and /ES intact', eq(r?.symbols, ['BRK.B', '/ES']), JSON.stringify(r?.symbols));
  ok('scan still Trend without the period', r?.scan === 'Trend', r?.scan);
}

// --- another scan is a clean ignore -----------------------------------------

section('An alert for another scan is ignored, not treated as junk');

{
  const subject = 'Alert: New symbols: NVDA, AMD were added to Premarket Movers.';
  const structural = parseAlertSubject(subject);
  ok('still parses structurally', structural !== null);
  ok('scan is Premarket Movers', structural?.scan === 'Premarket Movers', structural?.scan);
  ok('not the Trend scan', isTrendScan(structural?.scan ?? '') === false);
  ok('parseTrendAlert returns null for it', parseTrendAlert(subject) === null);
}

section('The Trend scan is matched case- and space-insensitively');

ok('trend', isTrendScan('trend'));
ok('  Trend  (padded)', isTrendScan('  Trend  '));
ok('TREND', isTrendScan('TREND'));
ok('Trending is NOT Trend', isTrendScan('Trending') === false);

// --- junk is rejected --------------------------------------------------------

section('Junk and unrelated subjects return null');

for (const junk of [
  '',
  'Your statement is ready',
  'Alert: something happened',
  'Alert: New symbols: were added to Trend.', // no tickers between colon and verb
  null,
  undefined,
]) {
  ok(`null for ${JSON.stringify(junk)}`, parseAlertSubject(junk) === null);
}

// --- applying changes to the running list ------------------------------------

section('Applying changes keeps the list uppercase, unique and sorted');

ok(
  'add merges and sorts',
  eq(applyTrendChange(['TEM'], 'added', ['bbwi', 'MRNA']), ['BBWI', 'MRNA', 'TEM']),
  JSON.stringify(applyTrendChange(['TEM'], 'added', ['bbwi', 'MRNA'])),
);
ok(
  'add is idempotent',
  eq(applyTrendChange(['AAPL'], 'added', ['AAPL']), ['AAPL']),
);
ok(
  'remove drops the named symbol',
  eq(applyTrendChange(['AAPL', 'MSFT'], 'removed', ['MSFT']), ['AAPL']),
);
ok(
  'removing an absent symbol is a no-op',
  eq(applyTrendChange(['AAPL'], 'removed', ['ZZZZ']), ['AAPL']),
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
