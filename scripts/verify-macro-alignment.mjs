/*
 * Validation of the macro-alignment classifier and the macro-fit wording.
 *
 * The tag drives a plain-English read on /decision and the Scanner's "Macro
 * alignment" filter, so the risks are: a sector silently landing in the wrong
 * category, a name the override is meant to promote slipping back to its raw
 * GICS category, or the growth wording saying "helps" when yields are rising.
 * Every GICS sector is walked (so there are no gaps), the named mega-caps are
 * pinned to growth, and the growth yields wording is checked both ways.
 *
 * Run: npm run verify:macro-alignment
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { macroAlignmentFor, SECTOR_CATEGORY, MANUAL_OVERRIDE } = await import(
  '../src/lib/redesign/macroAlignment.ts'
);
const { macroFitCopy } = await import('../src/lib/redesign/macroFitCopy.ts');
const { GICS_NAMES } = await import('../src/lib/rs/universe.ts');

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

// --- every GICS sector maps to a real category (no gaps) ---------------------

section('Every GICS sector has a non-empty category');

for (const gics of Object.keys(GICS_NAMES)) {
  const cat = SECTOR_CATEGORY[gics];
  ok(`${gics} → a category`, Boolean(cat) && cat !== 'aligned', String(cat));
}

section('Sector → category map');

ok('technology → growth', SECTOR_CATEGORY.technology === 'growth');
ok('communication-services → growth', SECTOR_CATEGORY['communication-services'] === 'growth');
ok('financials → rate-sensitive', SECTOR_CATEGORY.financials === 'rate-sensitive');
ok('real-estate → rate-sensitive', SECTOR_CATEGORY['real-estate'] === 'rate-sensitive');
ok('consumer-staples → defensive', SECTOR_CATEGORY['consumer-staples'] === 'defensive');
ok('utilities → defensive', SECTOR_CATEGORY.utilities === 'defensive');
ok('health-care → defensive', SECTOR_CATEGORY['health-care'] === 'defensive');
ok('industrials → cyclical', SECTOR_CATEGORY.industrials === 'cyclical');
ok('energy → cyclical', SECTOR_CATEGORY.energy === 'cyclical');
ok('materials → cyclical', SECTOR_CATEGORY.materials === 'cyclical');
ok('consumer-discretionary → cyclical (default)', SECTOR_CATEGORY['consumer-discretionary'] === 'cyclical');

// --- the named mega-caps all tag Growth --------------------------------------

section('Mega-cap tech / semis / comms → Growth');

const tag = (sym, sector) => macroAlignmentFor(sym, { sector });
ok('NVDA (technology) → growth', tag('NVDA', 'technology') === 'growth');
ok('AAPL (technology) → growth', tag('AAPL', 'technology') === 'growth');
ok('MSFT (technology) → growth', tag('MSFT', 'technology') === 'growth');
ok('AMD (technology) → growth', tag('AMD', 'technology') === 'growth');
ok('AVGO (technology) → growth', tag('AVGO', 'technology') === 'growth');
ok('GOOGL (communication-services) → growth', tag('GOOGL', 'communication-services') === 'growth');
ok('META (communication-services) → growth', tag('META', 'communication-services') === 'growth');

section('Overrides beat the raw GICS sector');

// AMZN and TSLA are Consumer Discretionary by GICS (→ cyclical) but trade as growth.
ok('AMZN (cons-disc) → growth via override', tag('AMZN', 'consumer-discretionary') === 'growth');
ok('TSLA (cons-disc) → growth via override', tag('TSLA', 'consumer-discretionary') === 'growth');
ok('override list has AMZN & TSLA', MANUAL_OVERRIDE.AMZN === 'growth' && MANUAL_OVERRIDE.TSLA === 'growth');

section('The other spec anchors');

ok('JPM (financials) → rate-sensitive', tag('JPM', 'financials') === 'rate-sensitive');
ok('XOM (energy) → cyclical', tag('XOM', 'energy') === 'cyclical');
ok('WMT (consumer-staples) → defensive', tag('WMT', 'consumer-staples') === 'defensive');

// --- precedence + fallbacks --------------------------------------------------

section('Precedence and fallbacks');

ok('earnings <24h beats sector', macroAlignmentFor('NVDA', { sector: 'technology', earningsWithin24h: true }) === 'event-risk');
ok('unknown sector, no override/ETF → aligned', macroAlignmentFor('ZZZZ', {}) === 'aligned');
ok('SPY (no sector) → aligned', macroAlignmentFor('SPY', { sector: null }) === 'aligned');
ok('XLK ETF fallback → growth', macroAlignmentFor('XLK', {}) === 'growth');
ok('XLF ETF fallback → rate-sensitive', macroAlignmentFor('XLF', {}) === 'rate-sensitive');
ok('XLU ETF fallback → defensive', macroAlignmentFor('XLU', {}) === 'defensive');

// --- macro-fit wording -------------------------------------------------------

section('Growth wording follows yields, not the backdrop');

const g = (yields, backdrop = 'neutral') => macroFitCopy({ category: 'growth', backdrop, yields });
ok('yields rising → conflicted', g('rising').fit === 'conflicted');
ok('rising says headwind', /headwind/i.test(g('rising').why));
ok('yields falling → aligned', g('falling').fit === 'aligned');
ok('falling says helps', /helps/i.test(g('falling').why));
ok('yields flat → neutral', g('flat').fit === 'neutral');
ok('growth sensitivity label', g('rising').sensitivity === 'Growth, rate-sensitive');
ok('growth why never gives advice', !/\b(buy|sell|long|short|target)\b/i.test(g('rising').why));

section('Other categories read against the backdrop');

ok('defensive + risk-off → aligned', macroFitCopy({ category: 'defensive', backdrop: 'bearish', yields: 'flat' }).fit === 'aligned');
ok('defensive + risk-on → conflicted', macroFitCopy({ category: 'defensive', backdrop: 'bullish', yields: 'flat' }).fit === 'conflicted');
ok('cyclical + risk-on → aligned', macroFitCopy({ category: 'cyclical', backdrop: 'bullish', yields: 'flat' }).fit === 'aligned');
ok('cyclical + risk-off → conflicted', macroFitCopy({ category: 'cyclical', backdrop: 'bearish', yields: 'flat' }).fit === 'conflicted');
ok('rate-sensitive stays neutral (banks vs REITs differ)', macroFitCopy({ category: 'rate-sensitive', backdrop: 'bullish', yields: 'rising' }).fit === 'neutral');
ok('aligned → no tilt wording', /stands on its own/i.test(macroFitCopy({ category: 'aligned', backdrop: 'neutral', yields: 'flat' }).why));

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
