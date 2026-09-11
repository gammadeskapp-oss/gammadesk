/*
 * Validation of the /decision context band's data layer:
 *   - the per-level hold-rate backtest in src/lib/decision/backtest.ts
 *   - the band assembly in src/lib/decision/contextBand.ts
 *
 * Node 22.6+ strips the TypeScript, so the modules under test are imported
 * directly. Every fixture is hand-built, with the level sitting at exactly 100
 * and each session written as an explicit high/low/close, so the expected hold
 * count can be read off the fixture by eye rather than trusted to the code.
 *
 * The load-bearing check is the last one: the 5-day and 20-day hold rates must
 * disagree on seeded data. The whole reason the horizon switch exists is that a
 * level can hold all week and have broken repeatedly the month before; a bug
 * that carried the 5-day figure into the 20-day view would erase exactly that,
 * and would still render a plausible-looking band.
 *
 * Run: npm run verify:context-band
 */

import { registerTsImports } from './ts-imports.mjs';

// Teaches the loader to resolve the extensionless `.ts` imports the source
// modules use, exactly as every other verify script does.
registerTsImports();

const { holdRate, windowRange } = await import('../src/lib/decision/backtest.ts');
const { buildContextBand, HORIZONS } = await import('../src/lib/decision/contextBand.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function near(label, actual, expected, tolerance = 1e-9) {
  ok(label, Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

function section(name) {
  console.log(`\n${name}`);
}

// --- fixtures ----------------------------------------------------------------

const LEVEL = 100;

/** A daily bar dated `day` days after 2026-01-05, stamped at 16:00 ET. */
function bar(day, { h, l, c }) {
  const t = Date.UTC(2026, 0, 5 + day, 21, 0, 0) / 1000; // 21:00 UTC = 16:00 EST
  return { t, h, l, c };
}

/** A session that reached 100 and closed back below it — a hold for a wall above. */
const HELD_ABOVE = { h: 101, l: 99, c: 99.5 };
/** A session that reached 100 and closed above it — a break of a wall above. */
const BROKE_ABOVE = { h: 102, l: 99, c: 101 };
/** A session whose whole range sat below 100 — never a test of the level. */
const UNTOUCHED = { h: 98, l: 96, c: 97 };

// --- hold rate ---------------------------------------------------------------

section('Hold rate counts only sessions that reached the level');

{
  const bars = [
    bar(0, UNTOUCHED),
    bar(1, HELD_ABOVE),
    bar(2, BROKE_ABOVE),
    bar(3, HELD_ABOVE),
  ];
  const r = holdRate(bars, LEVEL, 'above', 10);
  ok('untouched sessions stay out of the denominator', r.tested === 3, `tested ${r.tested}`);
  ok('holds are counted', r.held === 2, `held ${r.held}`);
  near('rate is holds over tests', r.rate, 2 / 3);
  ok('a computed rate carries no reason', r.reason === null);
}

{
  // A wall below spot: price approaches from above, holds by closing back above.
  const heldBelow = { h: 101, l: 99, c: 100.5 };
  const brokeBelow = { h: 101, l: 98, c: 98.5 };
  const r = holdRate([bar(0, heldBelow), bar(1, brokeBelow)], LEVEL, 'below', 10);
  ok('the below side mirrors the above side', r.tested === 2 && r.held === 1, JSON.stringify(r));
}

{
  const r = holdRate([bar(0, UNTOUCHED), bar(1, UNTOUCHED)], LEVEL, 'above', 10);
  ok('a level never reached yields no rate', r.rate === null);
  ok('and says why', typeof r.reason === 'string' && r.reason.includes('did not reach'), r.reason);
}

{
  const r = holdRate([], LEVEL, 'above', 10);
  ok('no bars yields no rate', r.rate === null && r.tested === 0, JSON.stringify(r));
}

// --- window range ------------------------------------------------------------

section('Window range reports the sessions actually in scope');

{
  const bars = Array.from({ length: 8 }, (_, i) => bar(i, HELD_ABOVE));
  const w = windowRange(bars, 5);
  ok('window covers the last five sessions', w.sessions === 5, `sessions ${w.sessions}`);
  ok('window starts at the sixth-from-last date', w.from === '2026-01-08', w.from);
  ok('window ends at the last date', w.to === '2026-01-12', w.to);

  const short = windowRange(bars.slice(0, 3), 5);
  ok('a shorter history simply reports fewer sessions', short.sessions === 3, `sessions ${short.sessions}`);
}

// --- the horizon switch really recomputes -----------------------------------

section('5-day and 20-day hold rates disagree on seeded data');

/*
 * Twenty-five sessions. The oldest fifteen inside the 20-session window all
 * break the wall; the most recent five all hold it. So:
 *   - 5-day  window: 5 tested, 5 held  -> 1.00
 *   - 20-day window: 20 tested, 5 held -> 0.25
 * Any code that reuses one answer for the other fails this outright.
 */
const seeded = [];
for (let i = 0; i < 25; i += 1) {
  const held = i >= 20; // last five sessions hold
  seeded.push(bar(i, held ? HELD_ABOVE : BROKE_ABOVE));
}

{
  const five = holdRate(seeded, LEVEL, 'above', 5);
  const twenty = holdRate(seeded, LEVEL, 'above', 20);
  near('5-day rate is a clean sweep of holds', five.rate, 1);
  near('20-day rate is dragged down by the earlier breaks', twenty.rate, 0.25);
  ok('the two horizons genuinely differ', five.rate !== twenty.rate, `${five.rate} vs ${twenty.rate}`);
}

// --- the assembled band ------------------------------------------------------

section('buildContextBand assembles both horizons and the surrounding reads');

/** A stubbed event lookup, so the pure builder needs no calendar. */
const noEvents = () => ({ count: 0, names: [] });

function baseInput(over = {}) {
  return {
    symbol: 'SPY',
    spot: 100,
    quoteDateLabel: 'Jan 30, 2026, 16:00 ET',
    stale: false,
    regime: 'positive',
    observedRegime: 'positive',
    flipLevel: 98,
    flipDistancePct: 2.04,
    magnetAbove: { strike: LEVEL, distancePct: 0 },
    magnetBelow: { strike: 95, distancePct: -5 },
    dailyBars: seeded,
    breadthPct: 61,
    atmIv: 0.18,
    realisedVol: 0.14,
    regimeTracked: true,
    regimeSides: [
      { date: '2026-01-28', side: 'above' },
      { date: '2026-01-29', side: 'above' },
      { date: '2026-01-30', side: 'above' },
    ],
    eventsInWindow: noEvents,
    ...over,
  };
}

{
  const band = buildContextBand(baseInput());
  ok('one view per horizon', band.horizons.length === HORIZONS.length, `${band.horizons.length}`);

  const five = band.horizons.find((h) => h.horizon === 5);
  const twenty = band.horizons.find((h) => h.horizon === 20);
  near('band carries the 5-day call-wall rate', five.holds.callWall.rate, 1);
  near('band carries the 20-day call-wall rate', twenty.holds.callWall.rate, 0.25);
  ok(
    'the band never carries one horizon into the other',
    five.holds.callWall.rate !== twenty.holds.callWall.rate,
  );

  ok('the put wall was never reached in the window', band.horizons[0].holds.putWall.rate === null);
  ok('call wall is named plainly', band.levels.find((l) => l.key === 'callWall').name === 'CALL WALL');
}

{
  const calm = buildContextBand(baseInput({ regime: 'positive' }));
  ok('positive gamma reads Calm', calm.regime.word === 'Calm' && calm.regime.tone === 'success');
  const wild = buildContextBand(baseInput({ regime: 'negative' }));
  ok('negative gamma reads Wild', wild.regime.word === 'Wild' && wild.regime.tone === 'warning');
}

{
  const held = buildContextBand(baseInput());
  ok('a steady regime reads "Unchanged since"', held.regime.changeLine.startsWith('Unchanged since'), held.regime.changeLine);

  const changed = buildContextBand(
    baseInput({
      regimeSides: [
        { date: '2026-01-28', side: 'below' },
        { date: '2026-01-29', side: 'above' },
        { date: '2026-01-30', side: 'above' },
      ],
    }),
  );
  ok('a recent crossing reads "Changed"', changed.regime.changeLine.startsWith('Changed'), changed.regime.changeLine);

  const untracked = buildContextBand(baseInput({ regimeTracked: false, regimeSides: [] }));
  ok('an untracked symbol says so rather than inventing a date', /tracked symbol only/.test(untracked.regime.changeLine), untracked.regime.changeLine);
}

{
  const band = buildContextBand(baseInput());
  near('VRP is implied minus realised, in points', band.market.vrp.valuePts, (0.18 - 0.14) * 100);
  ok('VRP with a value carries no reason', band.market.vrp.reason === null);

  const noIv = buildContextBand(baseInput({ atmIv: null }));
  ok('no implied vol yields no VRP', noIv.market.vrp.valuePts === null && typeof noIv.market.vrp.reason === 'string');
}

{
  const band = buildContextBand(baseInput());
  ok('breadth over 50 is an up tone', band.market.breadthTone === 'up');
  ok('the ETF states it has no earnings', /index ETF/.test(band.market.earnings), band.market.earnings);

  const disagree = buildContextBand(baseInput({ observedRegime: 'negative' }));
  ok('a chain/feed disagreement is surfaced', typeof disagree.regime.disagreement === 'string', disagree.regime.disagreement);
  ok('agreement leaves no disagreement note', band.regime.disagreement === null);
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
