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
 * Two load-bearing checks. First, the horizon must reach the computation: the
 * 5-day and 20-day windows test different session counts on seeded data, so a
 * bug that carried one figure into the other is caught. Second, the
 * minimum-sample rule: a window under the floor states no rate, so a wall
 * touched once or twice can never surface as a flattering 100%. Both would
 * otherwise render a plausible-looking band.
 *
 * Run: npm run verify:context-band
 */

import { registerTsImports } from './ts-imports.mjs';

// Teaches the loader to resolve the extensionless `.ts` imports the source
// modules use, exactly as every other verify script does.
registerTsImports();

const { holdRate, windowRange, MIN_HOLD_SESSIONS } = await import('../src/lib/decision/backtest.ts');
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

/*
 * Each fixture is padded over the minimum-sample floor with untouched sessions
 * — whose range never reaches the level, so they change neither the tested nor
 * the held count — while making the window long enough to state a rate. This
 * keeps the meaningful sessions readable by eye and isolates the counting logic
 * from the floor, which the next section tests on its own.
 */
function overFloor(meaningful) {
  const padCount = Math.max(0, MIN_HOLD_SESSIONS - meaningful.length);
  const pad = Array.from({ length: padCount }, (_, i) => bar(-1 - i, UNTOUCHED));
  return [...pad, ...meaningful];
}

{
  const bars = overFloor([
    bar(0, UNTOUCHED),
    bar(1, HELD_ABOVE),
    bar(2, BROKE_ABOVE),
    bar(3, HELD_ABOVE),
  ]);
  const r = holdRate(bars, LEVEL, 'above', bars.length);
  ok('untouched sessions stay out of the denominator', r.tested === 3, `tested ${r.tested}`);
  ok('holds are counted', r.held === 2, `held ${r.held}`);
  near('rate is holds over tests', r.rate, 2 / 3);
  ok('a computed rate carries no reason', r.reason === null);
}

{
  // A wall below spot: price approaches from above, holds by closing back above.
  const heldBelow = { h: 101, l: 99, c: 100.5 };
  const brokeBelow = { h: 101, l: 98, c: 98.5 };
  const bars = overFloor([bar(0, heldBelow), bar(1, brokeBelow)]);
  const r = holdRate(bars, LEVEL, 'below', bars.length);
  ok('the below side mirrors the above side', r.tested === 2 && r.held === 1, JSON.stringify(r));
}

{
  const bars = overFloor([bar(0, UNTOUCHED), bar(1, UNTOUCHED)]);
  const r = holdRate(bars, LEVEL, 'above', bars.length);
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

section('5-day and 20-day hold rates measure different windows');

/*
 * Twenty-five sessions. The oldest fifteen inside the 20-session window all
 * break the wall; the most recent five all hold it. So each window tests its
 * own slice:
 *   - 5-day  window: 5 tested, 5 held
 *   - 20-day window: 20 tested, 5 held -> 0.25
 * The five-session window is below the minimum-sample floor, so its rate is
 * withheld even though it was measured — the horizon still reaches the count.
 * Any code that reused one horizon's answer for the other would fail here.
 */
const seeded = [];
for (let i = 0; i < 25; i += 1) {
  const held = i >= 20; // last five sessions hold
  seeded.push(bar(i, held ? HELD_ABOVE : BROKE_ABOVE));
}

{
  const five = holdRate(seeded, LEVEL, 'above', 5);
  const twenty = holdRate(seeded, LEVEL, 'above', 20);
  // The horizon genuinely reaches the computation: each window tests its own
  // sessions, so the session counts differ.
  ok('the 5-day window tests five sessions', five.tested === 5, `tested ${five.tested}`);
  ok('the 20-day window tests twenty sessions', twenty.tested === 20, `tested ${twenty.tested}`);
  ok(
    'the two horizons test different session counts',
    five.tested !== twenty.tested,
    `${five.tested} vs ${twenty.tested}`,
  );
  // ...but only the longer window clears the floor, so the five-session sweep
  // is withheld rather than published as a flattering 100%.
  ok(
    'the five-session window is withheld as too short',
    five.rate === null && five.reason === 'not enough history yet',
    JSON.stringify(five),
  );
  near('the 20-day rate is dragged down by the earlier breaks', twenty.rate, 0.25);
}

// --- the minimum-sample rule -------------------------------------------------

section('A window under the floor shows no rate, only a reason');

{
  // Three sessions, two of them holds: a naive rate is 2/3 = 67%. It must not
  // render as a number — three sessions is not enough history to state one.
  const threeSessions = [bar(0, HELD_ABOVE), bar(1, BROKE_ABOVE), bar(2, HELD_ABOVE)];
  const r = holdRate(threeSessions, LEVEL, 'above', 20);
  ok('a three-session input yields no rate', r.rate === null, JSON.stringify(r));
  ok('and says the history is too short', r.reason === 'not enough history yet', r.reason);
  ok('the tested count is still reported', r.tested === 3, `tested ${r.tested}`);
  ok('two-of-three never surfaces as a 67% rate', r.rate === null);
}

{
  // The floor sits at 20 sessions: nineteen is one short, twenty earns a rate.
  const allHeld = (n) => Array.from({ length: n }, (_, i) => bar(i, HELD_ABOVE));
  ok('the floor is the documented 20 sessions', MIN_HOLD_SESSIONS === 20, String(MIN_HOLD_SESSIONS));

  const nineteen = holdRate(allHeld(19), LEVEL, 'above', 20);
  ok(
    'nineteen sessions is one short of the floor',
    nineteen.rate === null && nineteen.reason === 'not enough history yet',
    JSON.stringify(nineteen),
  );

  const twenty = holdRate(allHeld(20), LEVEL, 'above', 20);
  near('twenty sessions clears the floor and states a rate', twenty.rate, 1);
}

// --- the assembled band ------------------------------------------------------

section('buildContextBand assembles both horizons and the surrounding reads');

/** A stubbed event lookup, so the pure builder needs no calendar. */
const noEvents = () => [];

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
    breadthReason: null,
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
  ok(
    'band withholds the 5-day call-wall rate as too short',
    five.holds.callWall.rate === null && five.holds.callWall.reason === 'not enough history yet',
    JSON.stringify(five.holds.callWall),
  );
  near('band carries the 20-day call-wall rate', twenty.holds.callWall.rate, 0.25);
  ok(
    'the band never carries one horizon into the other',
    five.holds.callWall.rate !== twenty.holds.callWall.rate,
  );

  // The put wall sits at 95, which the seeded range never reaches — so over the
  // 20-session window it is untested rather than merely short of history.
  ok(
    'a wall the window never reached still yields no rate',
    twenty.holds.putWall.rate === null && /did not reach/.test(twenty.holds.putWall.reason),
    twenty.holds.putWall.reason,
  );
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
  ok('a real breadth value carries no reason', band.market.breadthReason === null);
  ok('the ETF states it has no earnings', /index ETF/.test(band.market.earnings), band.market.earnings);

  // Breadth absent: never a bare number, always a stated reason.
  const noBreadth = buildContextBand(
    baseInput({ breadthPct: null, breadthReason: 'no reading taken yet today' }),
  );
  ok('missing breadth has no value', noBreadth.market.breadthPct === null);
  ok('and always carries a reason', noBreadth.market.breadthReason === 'no reading taken yet today');
  const noBreadthNoReason = buildContextBand(baseInput({ breadthPct: null, breadthReason: null }));
  ok(
    'a null breadth with no reason still gets a fallback rather than a bare dash',
    typeof noBreadthNoReason.market.breadthReason === 'string' &&
      noBreadthNoReason.market.breadthReason.length > 0,
    noBreadthNoReason.market.breadthReason,
  );

  const disagree = buildContextBand(baseInput({ observedRegime: 'negative' }));
  ok('a chain/feed disagreement is surfaced', typeof disagree.regime.disagreement === 'string', disagree.regime.disagreement);
  ok('agreement leaves no disagreement note', band.regime.disagreement === null);
}

{
  // Events flow through with date, time and name, in each horizon view.
  const withEvents = buildContextBand(
    baseInput({
      eventsInWindow: (from, to) => [
        { date: '2026-01-14', timeEt: '08:30', name: 'CPI' },
        { date: '2026-01-28', timeEt: '14:00', name: 'FOMC decision' },
      ],
    }),
  );
  const view = withEvents.horizons.find((h) => h.horizon === 20);
  ok('events reach the horizon view', view.events.length === 2, `${view.events.length}`);
  ok('each event keeps its date, time and name', view.events[0].date === '2026-01-14' && view.events[0].timeEt === '08:30' && view.events[0].name === 'CPI');

  const noneView = buildContextBand(baseInput()).horizons[0];
  ok('an empty window carries an empty event list, not a fabricated one', Array.isArray(noneView.events) && noneView.events.length === 0);
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
