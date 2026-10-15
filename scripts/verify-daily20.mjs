/*
 * Validation of the Daily 20's direction-specific scoring (ship-order step 1).
 *
 * The page shows a Bullish Leader Score and a Bearish Laggard Score with all
 * seven components beside each total, and a reader acts on those numbers. This
 * pins: the weights, that both scores renormalise over the components a name
 * actually has, that the bearish score mirrors the bullish one, and that a
 * missing component (sector / gamma room, wired in later steps) drops out of
 * the blend instead of scoring zero.
 *
 * Run: npm run verify:daily20
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const {
  directionScore,
  bothDirectionScores,
  BULLISH_LEADER_WEIGHTS,
  BEARISH_LAGGARD_WEIGHTS,
  DIRECTION_COMPONENT_KEYS,
} = await import('../src/lib/scanner/directionScore.ts');

let failures = 0;
let checks = 0;
function ok(label, cond, detail) {
  checks += 1;
  if (cond) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(n) {
  console.log(`\n${n}`);
}
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// --- a row factory -----------------------------------------------------------

function metrics(over = {}) {
  return {
    rsScore: 90, rsRank: 10, m1Percentile: 85,
    pctAbove200: 12, ema200: 100, pctAbove50: 6, ema50: 110,
    pctAbove20: 2, ema20: 118, volumeRatio: 1.6, avgDollarVolume: 500e6,
    vwap20: 117, pctAboveVwap: 3,
    ...over,
  };
}
function row(over = {}) {
  const { metricsOver, ...rest } = over;
  return {
    symbol: 'TEST', price: 120, priceAsOf: '2026-10-15',
    metrics: metrics(metricsOver),
    equityTier: 'HIGH', optionsTier: 'HIGH',
    regime: 'positive', netGex: 5e7, magnets: [],
    optionsVolume: 50000, optionsOpenInterest: 200000,
    earnings: { state: 'known', dateIso: '2026-11-01', daysAway: 17, source: 'test' },
    extension: { pctAbove20Ema: 2, ema20: 118, extended: false },
    optionQuality: null,
    ...rest,
  };
}

// --- weights -----------------------------------------------------------------

section('Weights — the tunable constants sum to 100 and match the spec');
const sum = (w) => DIRECTION_COMPONENT_KEYS.reduce((a, k) => a + w[k], 0);
ok('bullish weights sum to 100', sum(BULLISH_LEADER_WEIGHTS) === 100, String(sum(BULLISH_LEADER_WEIGHTS)));
ok('bearish weights sum to 100', sum(BEARISH_LAGGARD_WEIGHTS) === 100, String(sum(BEARISH_LAGGARD_WEIGHTS)));
ok('rs is 30', BULLISH_LEADER_WEIGHTS.rs === 30 && BEARISH_LAGGARD_WEIGHTS.rs === 30);
ok('trend 20, structure 15, gammaRoom 5',
  BULLISH_LEADER_WEIGHTS.trend === 20 && BULLISH_LEADER_WEIGHTS.structure === 15 && BULLISH_LEADER_WEIGHTS.gammaRoom === 5);

// --- components always present ----------------------------------------------

section('Components — all seven keys always returned, never silently dropped');
const b = directionScore(row(), 'bullish');
ok('has all seven component keys', DIRECTION_COMPONENT_KEYS.every((k) => k in b.components));
ok('rs component equals rsScore for a leader', b.components.rs === 90);
ok('sector is null until wired (step 5)', b.components.sector === null);
ok('gammaRoom is null until wired (step 4)', b.components.gammaRoom === null);
ok('sector & gammaRoom are reported missing', b.missing.includes('sector') && b.missing.includes('gammaRoom'));
ok('measured = 5 when sector+gammaRoom absent', b.measured === 5, String(b.measured));
ok('total in [0,100]', b.total >= 0 && b.total <= 100);

// --- renormalisation ---------------------------------------------------------

section('Renormalisation — a missing component shrinks the blend, never zeroes it');
// With only rs measured, the total must equal the rs component exactly.
const onlyRs = directionScore(
  row({ metricsOver: { volumeRatio: null, pctAbove20: null, pctAboveVwap: null,
    pctAbove50: null, pctAbove200: null, ema50: null, ema200: null, m1Percentile: null },
    optionsVolume: null, optionsOpenInterest: null }),
  'bullish',
);
ok('only-rs row totals to the rs value', approx(onlyRs.total, 90), `total=${onlyRs.total}`);
ok('only-rs row measured = 1', onlyRs.measured === 1, String(onlyRs.measured));

// Supplying sector + gammaRoom changes the total (they now count).
const withExtras = directionScore(row(), 'bullish', { sectorStrength: 100, gammaRoom: 100 });
ok('adding sector+gammaRoom moves the total', withExtras.total !== b.total);
ok('with extras, nothing is missing', withExtras.missing.length === 0 && withExtras.measured === 7);

// A fully unmeasurable row scores 0, not NaN.
const empty = directionScore(
  row({ metricsOver: { rsScore: NaN, volumeRatio: null, pctAbove20: null, pctAboveVwap: null,
    pctAbove50: null, pctAbove200: null, ema50: null, ema200: null, m1Percentile: null },
    optionsVolume: null, optionsOpenInterest: null }),
  'bullish',
);
ok('fully unmeasurable row totals 0 (not NaN)', empty.total === 0);

// --- bullish vs bearish mirror ----------------------------------------------

section('Mirror — a strong leader scores low as a laggard, and vice versa');
const strong = bothDirectionScores(row());
ok('a clear leader: bullish > bearish', strong.bullish.total > strong.bearish.total,
  `bull=${strong.bullish.total.toFixed(1)} bear=${strong.bearish.total.toFixed(1)}`);
ok('bearish rs = 100 - bullish rs', strong.bearish.components.rs === 100 - strong.bullish.components.rs);

// A weak name: low RS, below every MA, below VWAP, weak month.
const weak = bothDirectionScores(row({
  regime: 'negative', netGex: -5e7,
  metricsOver: { rsScore: 15, m1Percentile: 10, pctAbove200: -12, pctAbove50: -6,
    pctAbove20: -3, pctAboveVwap: -4, ema50: 90, ema200: 110, volumeRatio: 1.8 },
}));
ok('a clear laggard: bearish > bullish', weak.bearish.total > weak.bullish.total,
  `bull=${weak.bullish.total.toFixed(1)} bear=${weak.bearish.total.toFixed(1)}`);
ok('laggard bearish trend is high (below both MAs, death order)',
  weak.bearish.components.trend >= 75, String(weak.bearish.components.trend));
ok('laggard bearish structure high (below 20d and VWAP)',
  weak.bearish.components.structure >= 75, String(weak.bearish.components.structure));

// --- options quality nudge ---------------------------------------------------

section('Options quality — badge nudges the liquidity base, both directions equal');
const withBadge = directionScore(row({ optionQuality: { badge: 'excellent', contract: null, reasons: ['x'], source: 'scan', checkedAt: '', quoteDateIso: null } }), 'bullish');
const noBadge = directionScore(row(), 'bullish');
ok('excellent badge lifts options vs no badge',
  withBadge.components.options > noBadge.components.options,
  `badge=${withBadge.components.options} none=${noBadge.components.options}`);
ok('options equal across directions for same row',
  bothDirectionScores(row()).bullish.components.options === bothDirectionScores(row()).bearish.components.options);

// --- quality gates (step 2) --------------------------------------------------

const { gateRow, DAILY20_GATES } = await import('../src/lib/scanner/daily20Gate.ts');

const strongPct = { m1: 80, m3: 75, m6: 70 };
const weakPct = { m1: 20, m3: 25, m6: 30 };

section('Gates — a qualified leader passes; each failure gates it out');
const passLeader = gateRow(row(), 'bullish', { rsPercentiles: strongPct });
ok('a clean leader passes the bullish gate', passLeader.passes, passLeader.reasons.join('; '));
ok('its reasons list is empty', passLeader.reasons.length === 0);

ok('below the 50-day gates a bullish name out',
  !gateRow(row({ metricsOver: { pctAbove50: -2 } }), 'bullish', { rsPercentiles: strongPct }).passes);
ok('50 below 200 gates out without the improving-trend flag',
  !gateRow(row({ metricsOver: { ema50: 90, ema200: 110 } }), 'bullish', { rsPercentiles: strongPct }).passes);
ok('improving-trend flag lets 50<200 through when 20>=50',
  gateRow(row({ metricsOver: { ema50: 90, ema200: 110, ema20: 95 } }), 'bullish',
    { rsPercentiles: strongPct, flags: { earningsPlay: false, allowImprovingTrend: true } }).passes);
ok('thin turnover gates out',
  !gateRow(row({ metricsOver: { avgDollarVolume: 5e6 } }), 'bullish', { rsPercentiles: strongPct }).passes);
ok('RS positive on only 1 of 3 lookbacks gates out',
  !gateRow(row(), 'bullish', { rsPercentiles: { m1: 80, m3: 40, m6: 30 } }).passes);
ok('RS positive on 2 of 3 passes', gateRow(row(), 'bullish', { rsPercentiles: { m1: 80, m3: 60, m6: 30 } }).passes);

section('Gates — earnings window, extended flag');
const earns = gateRow(row({ earnings: { state: 'known', dateIso: '2026-10-18', daysAway: 3, source: 't' } }),
  'bullish', { rsPercentiles: strongPct });
ok('earnings inside the window gates out by default', !earns.passes);
ok('earnings is surfaced as an observation', earns.observations.earningsSoon);
ok('earnings-play flag lets it through',
  gateRow(row({ earnings: { state: 'known', dateIso: '2026-10-18', daysAway: 3, source: 't' } }),
    'bullish', { rsPercentiles: strongPct, flags: { earningsPlay: true, allowImprovingTrend: false } }).passes);
ok('extended flag set past the band, still passes',
  (() => { const g = gateRow(row({ metricsOver: { pctAbove20: 12 } }), 'bullish', { rsPercentiles: strongPct }); return g.passes && g.observations.extended; })());
ok('unknown earnings does not gate out (codebase rule)',
  gateRow(row({ earnings: { state: 'unknown', dateIso: null, daysAway: null, source: 't' } }), 'bullish', { rsPercentiles: strongPct }).passes);

section('Gates — bearish mirror and breakdown phase');
const laggardRow = row({ regime: 'negative', netGex: -5e7,
  metricsOver: { rsScore: 15, m1Percentile: 10, pctAbove200: -12, pctAbove50: -6, pctAbove20: -3,
    pctAboveVwap: -4, ema50: 90, ema200: 110 } });
const passLag = gateRow(laggardRow, 'bearish', { rsPercentiles: weakPct });
ok('a clean laggard passes the bearish gate', passLag.passes, passLag.reasons.join('; '));
ok('fresh breakdown phase near the 20-day', passLag.observations.breakdownPhase === 'fresh',
  String(passLag.observations.breakdownPhase));
const stretched = gateRow(row({ regime: 'negative',
  metricsOver: { rsScore: 15, pctAbove200: -20, pctAbove50: -12, pctAbove20: -15, pctAboveVwap: -10, ema50: 90, ema200: 110 } }),
  'bearish', { rsPercentiles: weakPct });
ok('far below the 20-day reads as stretched', stretched.observations.breakdownPhase === 'stretched');
ok('a name above its 50-day cannot be a laggard',
  !gateRow(row(), 'bearish', { rsPercentiles: weakPct }).passes);
ok('DAILY20_GATES default dollar-volume floor is $20M', DAILY20_GATES.minDollarVolume === 20_000_000);

// --- assembly + labels (step 3 / step 5 labels) -----------------------------

const { assembleDaily20, setupState, displayLabel, DAILY20_PER_SIDE } = await import(
  '../src/lib/scanner/daily20.ts'
);

section('Assembly — gate first, then rank, 10 + 10, sorted by score');
// 12 leaders of descending RS, 12 laggards, plus 3 names that fail the gate.
const universe = [];
for (let i = 0; i < 12; i++) {
  universe.push(row({ symbol: `LEAD${i}`, metricsOver: { rsScore: 95 - i, avgDollarVolume: 400e6,
    pctAbove50: 5, pctAbove200: 10, pctAbove20: 1, pctAboveVwap: 2, ema50: 110, ema200: 100 } }));
}
for (let i = 0; i < 12; i++) {
  universe.push(row({ symbol: `LAG${i}`, regime: 'negative', netGex: -4e7,
    metricsOver: { rsScore: 10 + i, m1Percentile: 15, avgDollarVolume: 400e6,
      pctAbove50: -5, pctAbove200: -8, pctAbove20: -2, pctAboveVwap: -3, ema50: 90, ema200: 110 } }));
}
// A thin name and a sub-50-day name that must be gated out of the leaders.
universe.push(row({ symbol: 'THIN', metricsOver: { rsScore: 99, avgDollarVolume: 2e6,
  pctAbove50: 5, pctAbove200: 10, ema50: 110, ema200: 100 } }));

const rsMap = new Map();
for (const r of universe) {
  const strong = r.symbol.startsWith('LEAD') || r.symbol === 'THIN';
  rsMap.set(r.symbol, strong ? { m1: 80, m3: 70, m6: 65 } : { m1: 20, m3: 25, m6: 30 });
}

const d20 = assembleDaily20(universe, { rsPercentilesBySymbol: rsMap });
ok('exactly 10 bullish', d20.bullish.length === 10, String(d20.bullish.length));
ok('exactly 10 bearish', d20.bearish.length === 10, String(d20.bearish.length));
ok('DAILY20_PER_SIDE is 10', DAILY20_PER_SIDE === 10);
ok('bullish sorted by score desc',
  d20.bullish.every((e, i) => i === 0 || d20.bullish[i - 1].score.total >= e.score.total));
ok('top bullish is the highest-RS leader', d20.bullish[0].symbol === 'LEAD0', d20.bullish[0].symbol);
ok('ranks are 1..10', d20.bullish.every((e, i) => e.rank === i + 1));
ok('THIN (thin turnover) is gated out of the leaders',
  !d20.bullish.some((e) => e.symbol === 'THIN'));
ok('12 leaders eligible, trimmed to 10', d20.eligible.bullish === 12, String(d20.eligible.bullish));
ok('laggards are the weak names', d20.bearish.every((e) => e.symbol.startsWith('LAG')));
ok('every entry carries both labels and a reason',
  d20.bullish.every((e) => e.leadership && e.display && e.reason && e.setup));

section('Labels — setup axis and the fixed display vocabulary');
ok('extended name -> "Leader, extended"',
  displayLabel('bullish', setupState(row({ metricsOver: { pctAbove20: 12 } }), 'bullish')) === 'Leader, extended');
ok('pullback -> "Actionable leader"',
  displayLabel('bullish', setupState(row({ metricsOver: { pctAbove20: -2, pctAbove50: 4 } }), 'bullish')) === 'Actionable leader');
ok('breaking out -> "Actionable leader"',
  displayLabel('bullish', setupState(row({ metricsOver: { pctAbove20: 2, pctAboveVwap: 1 } }), 'bullish')) === 'Actionable leader');
ok('stretched laggard -> "Laggard, stretched"',
  displayLabel('bearish', setupState(row({ metricsOver: { pctAbove20: -12 } }), 'bearish')) === 'Laggard, stretched');
ok('fresh breakdown -> "Actionable laggard"',
  displayLabel('bearish', setupState(row({ metricsOver: { pctAbove20: -2 } }), 'bearish')) === 'Actionable laggard');
ok('leadership and display are distinct axes',
  d20.bullish[0].leadership !== d20.bullish[0].display);

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
