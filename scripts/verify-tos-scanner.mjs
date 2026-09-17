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

const {
  parseAlertSubject,
  parseTrendAlert,
  parseAlertClauses,
  parseTrendOps,
  applyTrendOps,
  isTrendScan,
  applyTrendChange,
} = await import('../src/lib/tos/parse.ts');

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

// --- multi-clause emails: the production bug ---------------------------------

section('One email carrying BOTH an add and a remove (the real failure)');

// The exact subject that was being dropped whole: the scan of the first clause
// used to read "Trend. Symbols: MRVL, NOK were removed from Trend", failing the
// Trend check and discarding all 13 additions.
const REAL_COMBINED =
  'Alert: New symbols: AMD, BMNR, HYG, IONQ, MRNA, MSTR, ON, RIVN, RKLB, SKHY, SLV, TEM, TSLA were added to Trend. Symbols: MRVL, NOK were removed from Trend.';

{
  const ops = parseTrendOps(REAL_COMBINED);
  ok('finds two Trend operations', ops.length === 2, String(ops.length));
  ok('first is the 13-symbol add', ops[0]?.action === 'added' && ops[0]?.symbols.length === 13);
  ok(
    'the add carries every symbol',
    eq(ops[0]?.symbols, ['AMD', 'BMNR', 'HYG', 'IONQ', 'MRNA', 'MSTR', 'ON', 'RIVN', 'RKLB', 'SKHY', 'SLV', 'TEM', 'TSLA']),
    JSON.stringify(ops[0]?.symbols),
  );
  ok('second is the remove of MRVL, NOK', ops[1]?.action === 'removed' && eq(ops[1]?.symbols, ['MRVL', 'NOK']));

  // Applied onto a list that already holds MRVL and NOK (and something older).
  const result = applyTrendOps(['MRVL', 'NOK', 'ZZZ'], ops);
  ok('MRVL and NOK end up removed', !result.includes('MRVL') && !result.includes('NOK'));
  ok('all 13 additions are present', ['AMD', 'BMNR', 'HYG', 'IONQ', 'MRNA', 'MSTR', 'ON', 'RIVN', 'RKLB', 'SKHY', 'SLV', 'TEM', 'TSLA'].every((s) => result.includes(s)));
  ok('the pre-existing unrelated symbol is untouched', result.includes('ZZZ'));
}

section('Added-only and removed-only emails still parse');

ok(
  'added-only yields one add op',
  eq(parseTrendOps('Alert: New symbols: BBWI, MRNA, TEM were added to Trend.'), [
    { action: 'added', symbols: ['BBWI', 'MRNA', 'TEM'] },
  ]),
);
ok(
  'removed-only yields one remove op',
  eq(parseTrendOps('Alert: Symbols: XYZ were removed from Trend.'), [
    { action: 'removed', symbols: ['XYZ'] },
  ]),
);

section('Mixed-scan emails apply only the Trend clause');

// An add to Trend and a remove from another scan in one email: only Trend acts.
ok(
  'only the Trend clause survives',
  eq(
    parseTrendOps('Alert: New symbols: AAA were added to Trend. Symbols: BBB were removed from Premarket Movers.'),
    [{ action: 'added', symbols: ['AAA'] }],
  ),
);
// parseAlertClauses still sees both, so nothing is silently lost.
ok('both clauses are visible to the parser', parseAlertClauses('Alert: New symbols: AAA were added to Trend. Symbols: BBB were removed from Premarket Movers.').length === 2);

section('Multi-line / body text parses the same as a subject');

ok(
  'a two-line body yields both ops',
  eq(
    parseTrendOps('New symbols: AMD were added to Trend.\nSymbols: NOK were removed from Trend.'),
    [
      { action: 'added', symbols: ['AMD'] },
      { action: 'removed', symbols: ['NOK'] },
    ],
  ),
);

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
