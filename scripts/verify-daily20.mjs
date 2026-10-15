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

// --- leadership change diff (step 6) ----------------------------------------

const { diffDaily20, RANK_MOVE_THRESHOLD } = await import('../src/lib/scanner/daily20Diff.ts');

section('Change diff — empty on first run, populated on the second');
function leadUniverse(spec) {
  // spec: array of {sym, rs} for leaders; fills 10+ so the side is full.
  const u = [];
  for (const { sym, rs, regime } of spec) {
    u.push(row({ symbol: sym, regime: regime ?? 'positive', netGex: (regime === 'negative' ? -4e7 : 4e7),
      metricsOver: { rsScore: rs, avgDollarVolume: 400e6, pctAbove50: 5, pctAbove200: 10,
        pctAbove20: 1, pctAboveVwap: 2, ema50: 110, ema200: 100 } }));
  }
  return u;
}
const rsStrong = (syms) => { const m = new Map(); for (const s of syms) m.set(s, { m1: 80, m3: 70, m6: 65 }); return m; };

const run1Names = Array.from({ length: 11 }, (_, i) => ({ sym: `A${i}`, rs: 95 - i }));
const run1 = assembleDaily20(leadUniverse(run1Names), { rsPercentilesBySymbol: rsStrong(run1Names.map((n) => n.sym)) });

ok('first run diff is empty (no prior)', diffDaily20(null, run1).length === 0);

// Run 2: drop A10 region, add NEWCOMER at the top, push A9 up a lot.
const run2Names = [
  { sym: 'NEW', rs: 99 },
  ...Array.from({ length: 9 }, (_, i) => ({ sym: `A${i}`, rs: 94 - i })),
  { sym: 'A9', rs: 93 }, // A9 jumps from rank ~10 to near the top
];
const run2 = assembleDaily20(leadUniverse(run2Names), { rsPercentilesBySymbol: rsStrong(run2Names.map((n) => n.sym)) });
const changes = diffDaily20(run1, run2);
ok('second run produces change lines', changes.length > 0, String(changes.length));
ok('NEW is reported as an entrant', changes.some((c) => c.kind === 'entrant' && c.symbol === 'NEW'));
ok('a dropped name is reported as an exit', changes.some((c) => c.kind === 'exit'));
// A move of <10 places inside the ten-deep list must NOT fire a rank-move line.
ok('a sub-threshold move does not spuriously fire', !changes.some((c) => c.kind === 'rank-move'));
ok('RANK_MOVE_THRESHOLD is 10 (brief value)', RANK_MOVE_THRESHOLD === 10);

section('Change diff — regime flip and side flip');
const base = [{ sym: 'FLIP', rs: 90, regime: 'positive' }, ...Array.from({ length: 10 }, (_, i) => ({ sym: `B${i}`, rs: 88 - i }))];
const r1 = assembleDaily20(leadUniverse(base), { rsPercentilesBySymbol: rsStrong(base.map((n) => n.sym)) });
const base2 = [{ sym: 'FLIP', rs: 90, regime: 'negative' }, ...Array.from({ length: 10 }, (_, i) => ({ sym: `B${i}`, rs: 88 - i }))];
const r2 = assembleDaily20(leadUniverse(base2), { rsPercentilesBySymbol: rsStrong(base2.map((n) => n.sym)) });
ok('a gamma-regime flip is reported',
  diffDaily20(r1, r2).some((c) => c.kind === 'regime-flip' && c.symbol === 'FLIP'));

// Side flip: a leader becomes a laggard next run.
const lead = assembleDaily20(leadUniverse([{ sym: 'SWING', rs: 90 }, ...Array.from({ length: 10 }, (_, i) => ({ sym: `C${i}`, rs: 88 - i }))]),
  { rsPercentilesBySymbol: rsStrong(['SWING', ...Array.from({ length: 10 }, (_, i) => `C${i}`)]) });
const lagUniverse = [row({ symbol: 'SWING', regime: 'negative', netGex: -4e7,
  metricsOver: { rsScore: 10, m1Percentile: 15, avgDollarVolume: 400e6, pctAbove50: -5, pctAbove200: -8,
    pctAbove20: -2, pctAboveVwap: -3, ema50: 90, ema200: 110 } })];
for (let i = 0; i < 10; i++) lagUniverse.push(row({ symbol: `D${i}`, regime: 'negative', netGex: -4e7,
  metricsOver: { rsScore: 12 + i, m1Percentile: 15, avgDollarVolume: 400e6, pctAbove50: -5, pctAbove200: -8,
    pctAbove20: -2, pctAboveVwap: -3, ema50: 90, ema200: 110 } }));
const lagMap = new Map(); for (const r of lagUniverse) lagMap.set(r.symbol, { m1: 20, m3: 25, m6: 30 });
const lag = assembleDaily20(lagUniverse, { rsPercentilesBySymbol: lagMap });
ok('leader -> laggard reported once as a side flip',
  (() => { const cs = diffDaily20(lead, lag); const flips = cs.filter((c) => c.symbol === 'SWING');
    return flips.length === 1 && flips[0].kind === 'side-flip'; })());

// --- "why this is here today" templates (step 7) ----------------------------

const { whyHereToday } = await import('../src/lib/scanner/daily20Reason.ts');

section('Why-here — both forms, risk line always present, no buy/sell words');
const leadEntry = d20.bullish[0];
const why = whyHereToday(leadEntry, {
  rsPercentiles: { m1: 82, m3: 74, m6: 69 },
  sectorName: 'Information Technology', sectorRank: { rank: 2, of: 11 },
  gamma: { regime: 'positive', flip: 776, upsideMagnet: 785, downsideMagnet: 772, roomPct: 4 },
  risk: { label: 'Earnings', daysAway: 17 },
});
ok('title names rank, direction and the two-axis label',
  why.title.includes('#1') && /leader/i.test(why.title) && why.title.includes(leadEntry.display));
ok('has an RS-across-periods line', why.lines.some((l) => l.includes('1M 82') && l.includes('6M 69')));
ok('has a group line with sector rank', why.lines.some((l) => l.includes('Information Technology') && l.includes('2 of 11')));
ok('has an MA-posture line', why.lines.some((l) => /50-day/.test(l)));
ok('has a setup line', why.lines.some((l) => /today's setup/i.test(l)));
ok('has a gamma line in SPY-page wording', why.lines.some((l) => /dealer hedging/.test(l) && /785/.test(l)));
ok('watch line is always present and last', why.lines[why.lines.length - 1] === why.watch && why.watch.startsWith('Watch'));

const banned2 = /\bbuy\b|\bsell\b|\bshort\b(?!-)|\blong\b(?!-)/i;
ok('no buy/sell/long/short language anywhere', !why.lines.some((l) => banned2.test(l)),
  why.lines.find((l) => banned2.test(l)));

// Bearish form, minimal context — risk line still present.
const lagEntry = d20.bearish[0];
const whyBear = whyHereToday(lagEntry, { risk: { label: 'CPI', daysAway: 1 } });
ok('bearish title says laggard', /laggard/i.test(whyBear.title));
ok('bearish still has setup + watch even with no RS/sector/gamma context',
  whyBear.lines.some((l) => /today's setup/i.test(l)) && whyBear.watch.includes('CPI'));
ok('a line-less context still yields a watch line',
  whyHereToday(lagEntry, {}).watch.length > 0);

// --- lifecycle states (step 4 / step 10) ------------------------------------

const { lifecycleState } = await import('../src/lib/scanner/daily20Lifecycle.ts');

section('Lifecycle — leadership + setup fold into one status with a watch line');
const mk = (direction, setup, leadership) => lifecycleState({ direction, setup, leadership });
ok('bullish breaking-out -> breakout', mk('bullish', 'breaking-out', 'Strong leader').state === 'breakout');
ok('bullish pullback -> pullback', mk('bullish', 'pullback', 'Leader').state === 'pullback');
ok('bullish extended -> extended', mk('bullish', 'extended', 'Strong leader').state === 'extended');
ok('bullish emerging leadership -> emerging', mk('bullish', 'breaking-out', 'Emerging leader').state === 'emerging');
ok('bullish neutral strong -> confirmed-leader', mk('bullish', 'neutral', 'Strong leader').state === 'confirmed-leader');
ok('bearish breaking-down -> breakdown', mk('bearish', 'breaking-down', 'Heavy laggard').state === 'breakdown');
ok('bearish stretched -> stretched', mk('bearish', 'stretched', 'Heavy laggard').state === 'stretched');
ok('bearish softening -> new-laggard', mk('bearish', 'breaking-down', 'Softening').state === 'new-laggard');
ok('every state carries a meaning and a watch line',
  ['breakout', 'pullback', 'extended', 'confirmed-leader', 'breakdown', 'stretched', 'new-laggard']
    .every((s) => { const l = mk(s.includes('down') || s.includes('laggard') || s === 'stretched' ? 'bearish' : 'bullish', 'neutral', 'Leader'); return l.meaning && l.watch; }));
ok('no buy/sell language in any watch line',
  !['bullish', 'bearish'].some((d) => ['breaking-out','pullback','extended','neutral','breaking-down','stretched']
    .some((s) => /\bbuy\b|\bsell\b/i.test(mk(d, s, 'Leader').watch))));

section('Lifecycle — damaged needs a prior run');
ok('a breakout that goes neutral since last run reads as damaged',
  lifecycleState({ direction: 'bullish', setup: 'neutral', leadership: 'Leader' }, { setup: 'breaking-out' }).state === 'damaged');
ok('no prior -> never damaged',
  lifecycleState({ direction: 'bullish', setup: 'neutral', leadership: 'Leader' }).state !== 'damaged');

// Entries now carry a lifecycle.
ok('assembled entries carry a lifecycle status',
  d20.bullish.every((e) => e.lifecycle && e.lifecycle.label && e.lifecycle.watch));

// --- sector confirmation (step 5) -------------------------------------------

const { buildSectorConfirmations, sectorLookups, SECTOR_STRONG, SECTOR_WEAK } = await import(
  '../src/lib/scanner/sectorConfirmation.ts'
);

section('Sector confirmation — strength map, peers, confirm/conflict verdict');
// Two leaders in a strong tech sector, one in a weak utilities sector.
const topLeaders = d20.bullish.slice(0, 3).map((e) => e.symbol);
const sectorsSnap = [
  { id: 'tech', name: 'Technology', score: 72, delta5: 3, members: [{ symbol: topLeaders[0] }, { symbol: topLeaders[1] }] },
  { id: 'util', name: 'Utilities', score: 38, delta5: -2, members: [{ symbol: topLeaders[2] }] },
];
const { infoBySymbol, strengthBySymbol } = sectorLookups(sectorsSnap);
ok('tech ranks #1 of 2', infoBySymbol.get(topLeaders[0]).rank === 1 && infoBySymbol.get(topLeaders[0]).of === 2);
ok('strength map carries the sector score', strengthBySymbol.get(topLeaders[0]) === 72);
ok('SECTOR_STRONG / WEAK thresholds exist', SECTOR_STRONG === 55 && SECTOR_WEAK === 45);

const above50 = new Map(d20.bullish.map((e) => [e.symbol, (e.row.metrics.pctAbove50 ?? 0) >= 0]));
const confs = buildSectorConfirmations(d20, infoBySymbol, above50);
ok('a leader in a strong, rising sector confirms', confs.get(topLeaders[0]).verdict === 'confirm');
ok('its peer count sees the other tech leader', confs.get(topLeaders[0]).peers === 1);
ok('a leader in a weak, falling sector conflicts', confs.get(topLeaders[2]).verdict === 'conflict');
ok('conflict line says the group is going the other way',
  /going the other way/.test(confs.get(topLeaders[2]).line));
ok('% above 50 is computed for the tech peers', confs.get(topLeaders[0]).pctAbove50 === 100);
ok('a symbol with no sector reading is absent from the result',
  !confs.has('ZZZZ'));

// Lighting up the SECT component: re-assemble with the strength map.
const withSector = assembleDaily20(universe, { rsPercentilesBySymbol: rsMap, sectorStrengthBySymbol: strengthBySymbol });
const lit = withSector.bullish.find((e) => e.symbol === topLeaders[0]);
ok('SECT component is no longer "—" once the strength map is supplied',
  lit && lit.score.components.sector === 72, String(lit?.score.components.sector));

// --- scorecard (step 8) ------------------------------------------------------

const { computeScorecard, HORIZONS } = await import('../src/lib/scanner/daily20Scorecard.ts');

section('Scorecard — direction-aware hit rate, raw median, breakdowns');
function listing(over) {
  return {
    date: '2026-09-01', symbol: 'X', direction: 'bullish', setup: 'breaking-out',
    regime: 'positive', sector: 'Technology', extended: false, newEntry: true,
    ret: { 1: 0.01, 5: 0.03, 10: 0.05, 20: 0.08 }, mfe: 0.1, mae: -0.02, ...over,
  };
}
const sc = computeScorecard([
  listing({ symbol: 'A', direction: 'bullish', ret: { 1: 0.02, 5: 0.04, 10: 0.06, 20: 0.1 } }),
  listing({ symbol: 'B', direction: 'bullish', ret: { 1: -0.01, 5: 0.01, 10: -0.02, 20: 0.03 } }),
  // A laggard that fell — a "hit" for a bearish listing.
  listing({ symbol: 'C', direction: 'bearish', regime: 'negative', setup: 'breaking-down',
    extended: true, newEntry: false, sector: 'Energy', ret: { 1: -0.03, 5: -0.05, 10: -0.04, 20: -0.09 } }),
]);
ok('HORIZONS are 1/5/10/20', HORIZONS.join(',') === '1,5,10,20');
ok('sampled counts the three listings', sc.sampled === 3);
ok('1d hit rate: A up, B down, C down(bear hit) = 2/3',
  Math.round(sc.overall[1].hitRate) === 67, String(sc.overall[1].hitRate));
ok('20d median is the raw middle return (+0.03)', Math.abs(sc.overall[20].median - 0.03) < 1e-9, String(sc.overall[20].median));
ok('median keeps sign (not flipped for the laggard)', sc.overall[20].median > 0);
ok('MFE median computed', sc.mfeMedian === 0.1);
ok('MAE median computed and negative', sc.maeMedian < 0);
ok('breakdown by regime splits positive/negative', sc.byRegime.length === 2);
ok('breakdown by direction splits leaders/laggards', sc.byDirection.length === 2);
ok('extended breakdown present', sc.byExtended.some((b) => b.key === 'extended') && sc.byExtended.some((b) => b.key === 'not-extended'));
ok('new vs continuing present', sc.byNewVsContinuing.length === 2);
ok('sector breakdown names the sectors', sc.bySector.some((b) => b.label === 'Technology'));

ok('an empty scorecard is all zeros, not NaN',
  (() => { const e = computeScorecard([]); return e.sampled === 0 && e.overall[1].hitRate === null && e.mfeMedian === null; })());

ok('a listing with no matured horizon is not sampled',
  computeScorecard([listing({ ret: { 1: null, 5: null, 10: null, 20: null } })]).sampled === 0);

// --- research plan (step 12) -------------------------------------------------

const { researchPlan } = await import('../src/lib/scanner/researchPlan.ts');

section('Research plan — conditions / confirmation / invalidation, no orders');
const planEntry = d20.bullish[0];
const plan = researchPlan(planEntry, { spot: planEntry.row.price });
ok('has conditions', plan.conditions.length > 0);
ok('has a confirmation line', plan.confirmation.length > 0);
ok('invalidation references the 50-day', /50-day/.test(plan.invalidation.text));
ok('invalidation carries a level when ema50 is known',
  planEntry.row.metrics.ema50 === null || plan.invalidation.level === planEntry.row.metrics.ema50);
ok('gamma line uses the SPY-page wording', /dealer hedging|not measured/.test(plan.gamma));
ok('event risk is always stated', plan.eventRisk.length > 0);
const planText = [plan.confirmation, plan.invalidation.text, plan.gamma, plan.eventRisk, ...plan.conditions].join(' ');
ok('no buy/sell/target/stop language', !/\bbuy\b|\bsell\b|\btarget\b|\bstop\b/i.test(planText), planText);

const bearPlan = researchPlan(d20.bearish[0], { spot: d20.bearish[0].row.price });
ok('bearish invalidation is a close ABOVE the 50-day', /above the 50-day/.test(bearPlan.invalidation.text));
ok('bearish confirmation talks about a break lower', /below|bounce/.test(bearPlan.confirmation));

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
