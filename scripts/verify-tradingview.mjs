/*
 * The pipe-delimited level code shared by the "Copy for TradingView" button and
 * the GammaDesk Levels Pine indicator (/tradingview/gammadesk-levels.pine).
 * If this format and the Pine parser ever disagree, users draw wrong levels, so
 * the format is pinned here.
 *
 * Run: npm run verify:tradingview
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { buildLevelCode, parseLevelCode, CODE_SEPARATOR } = await import(
  '../src/lib/tradingview/code.ts'
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

section('buildLevelCode formats SYMBOL|FLOOR|CEILING|FLIP');
ok(
  'the documented example round-trips',
  buildLevelCode({ symbol: 'SPY', floor: 760, ceiling: 765, flip: 763.21 }) === 'SPY|760|765|763.21',
  buildLevelCode({ symbol: 'SPY', floor: 760, ceiling: 765, flip: 763.21 }),
);
ok('separator is a pipe', CODE_SEPARATOR === '|');
ok('round strikes drop trailing zeros', buildLevelCode({ symbol: 'AAPL', floor: 220, ceiling: 230, flip: 225 }) === 'AAPL|220|230|225');
ok('flip keeps two decimals', buildLevelCode({ symbol: 'NVDA', floor: 170, ceiling: 180, flip: 176.5 }) === 'NVDA|170|180|176.5');
ok('symbol is upper-cased and trimmed', buildLevelCode({ symbol: ' spy ', floor: 1, ceiling: 2, flip: 1.5 }) === 'SPY|1|2|1.5');

section('buildLevelCode refuses an incomplete or bad map');
ok('missing flip -> null', buildLevelCode({ symbol: 'SPY', floor: 760, ceiling: 765, flip: null }) === null);
ok('missing floor -> null', buildLevelCode({ symbol: 'SPY', floor: null, ceiling: 765, flip: 763 }) === null);
ok('non-finite -> null', buildLevelCode({ symbol: 'SPY', floor: NaN, ceiling: 765, flip: 763 }) === null);
ok('zero price -> null', buildLevelCode({ symbol: 'SPY', floor: 0, ceiling: 765, flip: 763 }) === null);
ok('junk symbol -> null', buildLevelCode({ symbol: 'SP-Y', floor: 1, ceiling: 2, flip: 1.5 }) === null);
ok('too-long symbol -> null', buildLevelCode({ symbol: 'ABCDEF', floor: 1, ceiling: 2, flip: 1.5 }) === null);

section('parseLevelCode is the inverse and validates');
{
  const p = parseLevelCode('SPY|760|765|763.21');
  ok('parses the example', p && p.symbol === 'SPY' && p.floor === 760 && p.ceiling === 765 && p.flip === 763.21, JSON.stringify(p));
}
ok('parse is case-insensitive and trims', parseLevelCode(' aapl | 220 | 230 | 225 ')?.symbol === 'AAPL');
ok('wrong field count -> null', parseLevelCode('SPY|760|765') === null);
ok('non-numeric field -> null', parseLevelCode('SPY|760|x|763') === null);
ok('empty -> null', parseLevelCode('') === null);

section('build then parse is a faithful round-trip');
{
  const code = buildLevelCode({ symbol: 'META', floor: 700, ceiling: 720.5, flip: 711.4 });
  const p = parseLevelCode(code);
  ok('round-trips', p && p.symbol === 'META' && p.floor === 700 && p.ceiling === 720.5 && p.flip === 711.4, code);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
