/*
 * Validation of the failed-retest state machine in src/lib/retest/machine.ts.
 *
 * The module is imported and is the subject — Node 22.6+ strips the types.
 * Every fixture is hand-built so the expected answer is worked out on paper
 * first and written down as a literal, rather than being whatever the
 * implementation happened to produce.
 *
 * The technique that makes that possible: a level at exactly 100 with a buffer
 * driven to its 0.1% floor is a break below 99.9 and above 100.1, and every
 * bar below is written as an explicit open/high/low/close. That means each
 * transition can be read off the fixture by eye.
 *
 * What this exists to catch, all of which produce a plausible-looking feed
 * rather than an obvious break:
 *
 *   1. Breaking on a wick. The whole point of the detector is that a spike
 *      through a level which closes back inside is NOT a break. A machine that
 *      triggers on high/low instead of close reports every poke, which is the
 *      noise it was built to suppress — and it still looks like a working
 *      feed.
 *
 *   2. The upward direction being an afterthought. The brief is explicit that
 *      a level taken upwards and held is the same event mirrored. Every
 *      sequence below is therefore run in both directions and asserted to
 *      produce the same outcome, so a sign error on one side cannot hide.
 *
 *   3. A failed retest firing without the confirming extension. "Has not got
 *      back in yet" and "was pushed away" are different statements; without
 *      the second bar the machine names the first as though it were the
 *      second.
 *
 *   4. Re-arming after a failed retest. Resetting to holding there lets one
 *      continuing move emit the same event repeatedly as it runs, which reads
 *      as four confirmations of a thing that happened once.
 *
 *   5. The cooldown failing open, which lets a level oscillating on the buffer
 *      fill the feed.
 *
 * Run: npm run verify:retests
 */

const {
  atr,
  bufferFor,
  initialState,
  levelMovedAway,
  step,
  volumeAboveAverage,
  ATR_PERIOD,
  EVENT_COOLDOWN_MINUTES,
  MIN_BUFFER_PCT,
  RETEST_TIMEOUT_MINUTES,
} = await import('../src/lib/retest/machine.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function near(label, actual, expected, tolerance = 1e-9) {
  ok(
    label,
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`,
  );
}

function section(name) {
  console.log(`\n${name}`);
}

// --- fixtures ----------------------------------------------------------------

const LEVEL = 100;
/** 0.1% of 100. The fixtures keep ranges small so this floor is the buffer. */
const BUFFER = LEVEL * MIN_BUFFER_PCT; // 0.1
const START = 1_800_000_000; // arbitrary, on a minute boundary

/** One bar, `m` minutes into the fixture. */
function bar(m, { o, h, l, c, v = 1000 }) {
  return { t: START + m * 60, o, h, l, c, v };
}

/**
 * Mirror a bar around the level, so an upward fixture is provably the same
 * shape as the downward one rather than a second hand-written sequence that
 * might quietly differ.
 */
function mirror(b) {
  return {
    t: b.t,
    o: 2 * LEVEL - b.o,
    h: 2 * LEVEL - b.l,
    l: 2 * LEVEL - b.h,
    c: 2 * LEVEL - b.c,
    v: b.v,
  };
}

/**
 * A bar sitting exactly on the level, one minute before the fixture starts.
 *
 * The first bar a level ever sees only establishes which side price is on, so
 * every fixture needs one before its own first bar can be a break. Prepended
 * here rather than written into each fixture, so the minute numbers inside the
 * fixtures still read as written.
 */
function armingBar(level) {
  return { t: START - 60, o: level, h: level, l: level, c: level, v: 1000 };
}

/** Drive a whole sequence through the machine, collecting what it emitted. */
function run(bars, { level = LEVEL, buffer = BUFFER, volumeFlag = true } = {}) {
  let state = initialState({ id: 'test', price: level }, 0);
  const events = [];
  for (const b of [armingBar(level), ...bars]) {
    const result = step(state, b, level, buffer, volumeFlag);
    state = result.state;
    if (result.event) events.push(result.event);
  }
  return { state, events };
}

/** Run a sequence downward and its mirror upward, and require agreement. */
function bothWays(label, bars, expect) {
  const down = run(bars);
  const up = run(bars.map(mirror));

  expect(down, 'down');
  expect(up, 'up');

  ok(
    `${label}: both directions emit the same outcomes`,
    JSON.stringify(down.events.map((e) => e.outcome)) ===
      JSON.stringify(up.events.map((e) => e.outcome)),
    `down ${JSON.stringify(down.events.map((e) => e.outcome))}, up ${JSON.stringify(up.events.map((e) => e.outcome))}`,
  );
  ok(
    `${label}: directions are labelled opposite`,
    down.events.every((e) => e.direction === 'down') &&
      up.events.every((e) => e.direction === 'up'),
  );
}

// --- the buffer --------------------------------------------------------------

section('Buffer and its inputs');

{
  // Fewer than period+1 bars cannot produce an average range.
  const short = Array.from({ length: ATR_PERIOD }, (_, i) =>
    bar(i, { o: 100, h: 100.2, l: 99.8, c: 100 }),
  );
  ok('average range is null below period+1 bars', atr(short) === null);
  near(
    'and the buffer falls back to the 0.1% floor',
    bufferFor(LEVEL, short),
    0.1,
  );

  /*
   * Fifteen bars each spanning exactly 2.0 with no gaps: every true range is
   * 2.0, so the average is 2.0 and a quarter of it is 0.5. That beats the 0.1
   * floor, which is the case the max() exists for.
   */
  const wide = Array.from({ length: ATR_PERIOD + 1 }, (_, i) =>
    bar(i, { o: 100, h: 101, l: 99, c: 100 }),
  );
  near('average range of constant 2.0 bars is 2.0', atr(wide), 2);
  near('a violent tape widens the buffer past the floor', bufferFor(LEVEL, wide), 0.5);
}

{
  const bars = [
    bar(0, { o: 100, h: 100, l: 100, c: 100, v: 100 }),
    bar(1, { o: 100, h: 100, l: 100, c: 100, v: 300 }),
    bar(2, { o: 100, h: 100, l: 100, c: 100, v: 199 }),
    bar(3, { o: 100, h: 100, l: 100, c: 100, v: 201 }),
  ];
  // Average of the first two is 200.
  ok('volume below the recent average is flagged false', !volumeAboveAverage(bars, 2));
  ok('volume above it is flagged true', volumeAboveAverage(bars, 3));
  ok('the first bar has no history to compare against', !volumeAboveAverage(bars, 0));
}

// --- the opening bar establishes a side, it does not break -------------------

section('The first bar establishes a side');

{
  /*
   * A level the session opens well below. Price was never above it, so nothing
   * was lost — but a machine that treats its first bar as a break reports one
   * at the open. On a real session that produced eight 09:30 events out of
   * twenty-two, every one of them describing the opening print.
   */
  let state = initialState({ id: 'opened-above', price: LEVEL }, 0);
  const opening = bar(0, { o: 105, h: 105.2, l: 104.8, c: 105 });
  const first = step(state, opening, LEVEL, BUFFER, true);

  ok('the opening bar emits nothing', first.event === null);
  ok('and leaves the level holding', first.state.status === 'holding');
  ok('but does arm it', first.state.armed === true);

  // From there, a genuine crossing back down through the level IS a break.
  state = first.state;
  const crossing = step(state, bar(1, { o: 105, h: 105, l: 99.4, c: 99.5 }), LEVEL, BUFFER, true);
  ok('a later genuine crossing still breaks', crossing.state.status === 'broken');
  ok('and it is recorded as lost', crossing.state.direction === 'down');
}

// --- a break is a close, never a wick ---------------------------------------

section('A break is a close, never a wick');

bothWays(
  'a deep wick that closes back inside',
  [
    // Low of 99.0 is far through the level; the close of 99.95 is not past
    // 99.9, so nothing has broken.
    bar(0, { o: 100, h: 100.05, l: 99.0, c: 99.95 }),
    bar(1, { o: 99.95, h: 100.1, l: 99.9, c: 100.02 }),
  ],
  (result, dir) => {
    ok(`wick only (${dir}): emits nothing`, result.events.length === 0);
    ok(`wick only (${dir}): stays holding`, result.state.status === 'holding');
  },
);

bothWays(
  'a close exactly on the buffer edge',
  [
    // Exactly 99.9 is not "more than the buffer" beyond 100. Strictly inside.
    bar(0, { o: 100, h: 100, l: 99.9, c: 99.9 }),
  ],
  (result, dir) => {
    ok(`buffer edge (${dir}): does not count as a break`, result.state.status === 'holding');
  },
);

bothWays(
  'a close past the buffer',
  [bar(0, { o: 100, h: 100, l: 99.5, c: 99.5 })],
  (result, dir) => {
    ok(`clear break (${dir}): becomes broken`, result.state.status === 'broken');
    ok(`clear break (${dir}): emits nothing yet`, result.events.length === 0);
  },
);

// --- the full failed retest --------------------------------------------------

section('Failed retest');

const FAILED_RETEST = [
  bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5, v: 5000 }), // break
  bar(1, { o: 99.5, h: 99.6, l: 99.4, c: 99.5 }), // drifting
  bar(2, { o: 99.5, h: 99.95, l: 99.5, c: 99.8 }), // retest: high reaches 99.9
  bar(3, { o: 99.8, h: 99.85, l: 99.3, c: 99.4 }), // lower low than 99.5 -> fires
];

bothWays('a level broken, retested and pushed away', FAILED_RETEST, (result, dir) => {
  ok(`failed retest (${dir}): one event`, result.events.length === 1);
  const e = result.events[0];
  if (!e) return;
  ok(`failed retest (${dir}): outcome`, e.outcome === 'failed-retest', e.outcome);
  ok(
    `failed retest (${dir}): break time is the breaking bar, not the confirmation`,
    e.brokenAt === new Date((START + 0 * 60) * 1000).toISOString(),
  );
  ok(
    `failed retest (${dir}): retest time is the touching bar`,
    e.retestedAt === new Date((START + 2 * 60) * 1000).toISOString(),
  );
  ok(
    `failed retest (${dir}): fires on the confirming bar`,
    e.firedAt === new Date((START + 3 * 60) * 1000).toISOString(),
  );
  ok(
    `failed retest (${dir}): stays broken rather than re-arming`,
    result.state.status === 'broken',
  );
});

{
  /*
   * The same sequence with the confirming bar removed. Price came back, failed
   * to close inside, and simply sat there. That is not yet a rejection, and
   * naming it one is failure mode 3.
   */
  const { events, state } = run(FAILED_RETEST.slice(0, 3));
  ok('without the confirming bar, nothing fires', events.length === 0);
  ok('and the level is left waiting in the retest', state.status === 'retested');
}

bothWays(
  'a retest that lingers without being pushed away',
  [
    bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5 }), // break
    bar(1, { o: 99.5, h: 99.95, l: 99.5, c: 99.8 }), // retest, extreme 99.5
    // Fails to close back above 100, but makes no lower low than 99.5. Price
    // is loitering under the level, which is not the same as being rejected
    // by it. This is the bar that separates the two claims.
    bar(2, { o: 99.8, h: 99.85, l: 99.6, c: 99.7 }),
    bar(3, { o: 99.7, h: 99.8, l: 99.55, c: 99.6 }),
  ],
  (result, dir) => {
    ok(`lingering retest (${dir}): fires nothing`, result.events.length === 0, `got ${result.events.length}`);
    ok(`lingering retest (${dir}): still waiting`, result.state.status === 'retested');
  },
);

{
  /*
   * Failure mode 4: a continuing move must not keep re-reporting itself. Four
   * more falling bars after the confirmation, all making lower lows.
   */
  const running = [
    ...FAILED_RETEST,
    bar(4, { o: 99.4, h: 99.4, l: 99.2, c: 99.25 }),
    bar(5, { o: 99.25, h: 99.3, l: 99.0, c: 99.05 }),
    bar(6, { o: 99.05, h: 99.1, l: 98.8, c: 98.85 }),
  ];
  const { events } = run(running);
  ok('a move that keeps running still reports once', events.length === 1, `got ${events.length}`);
}

// --- fake break --------------------------------------------------------------

section('Fake break');

bothWays(
  'a break that closes back on its original side',
  [
    bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5 }), // break
    bar(1, { o: 99.5, h: 100.2, l: 99.5, c: 100.15 }), // closed back above 100
  ],
  (result, dir) => {
    ok(`fake break (${dir}): one event`, result.events.length === 1);
    ok(
      `fake break (${dir}): outcome`,
      result.events[0]?.outcome === 'fake-break',
      result.events[0]?.outcome,
    );
    ok(`fake break (${dir}): resets to holding`, result.state.status === 'holding');
  },
);

bothWays(
  'a reclaim after price had already come back to check',
  [
    bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5 }),
    bar(1, { o: 99.5, h: 99.95, l: 99.5, c: 99.8 }), // retest
    bar(2, { o: 99.8, h: 100.3, l: 99.8, c: 100.2 }), // reclaimed from the retest
  ],
  (result, dir) => {
    ok(
      `reclaim from retest (${dir}): is a fake break`,
      result.events[0]?.outcome === 'fake-break',
      result.events[0]?.outcome,
    );
    ok(
      `reclaim from retest (${dir}): keeps the retest time`,
      result.events[0]?.retestedAt !== null,
    );
  },
);

// --- broke and left ----------------------------------------------------------

section('Broke and left');

{
  const bars = [bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5 })];
  // Bars well away from the level, one a minute, past the timeout.
  for (let m = 1; m <= RETEST_TIMEOUT_MINUTES; m += 1) {
    bars.push(bar(m, { o: 99.0, h: 99.1, l: 98.9, c: 99.0 }));
  }

  const { events, state } = run(bars);
  ok('a break with no retest reports once', events.length === 1, `got ${events.length}`);
  ok(
    'and the outcome says so',
    events[0]?.outcome === 'broke-and-left',
    events[0]?.outcome,
  );
  ok('with no retest time', events[0]?.retestedAt === null);
  ok(
    'and the level stays broken rather than re-arming',
    state.status === 'broken',
    state.status,
  );

  // One minute short of the timeout it must still be waiting.
  const early = run(bars.slice(0, RETEST_TIMEOUT_MINUTES));
  ok('one minute early, nothing fires', early.events.length === 0);
}

{
  /*
   * The treadmill, which a live replay caught and which no fixture above had
   * exercised: a level broken early and never revisited.
   *
   * If the timeout re-arms the level, price is still far beyond it, so the
   * next bar breaks it again and half an hour later it times out again — six
   * identical lines at exact thirty-minute intervals, describing the clock
   * rather than the tape. Two full hours of bars sitting well below the level
   * must produce exactly one event.
   */
  const bars = [bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5 })];
  for (let m = 1; m <= 120; m += 1) {
    bars.push(bar(m, { o: 99.0, h: 99.1, l: 98.9, c: 99.0 }));
  }

  const { events } = run(bars);
  ok(
    'a level broken and abandoned reports once, not once per half hour',
    events.length === 1,
    `got ${events.length}`,
  );
}

{
  /*
   * The same rule for a break that is confirmed by rejection and then keeps
   * being rejected. Both approaches are the same break; two lines would both
   * read "lost" at the same time.
   */
  const bars = [
    ...FAILED_RETEST, // fires at minute 3
    // Well past the cooldown, price comes back and is rejected again.
    bar(20, { o: 99.4, h: 99.95, l: 99.4, c: 99.8 }), // retest
    bar(21, { o: 99.8, h: 99.85, l: 99.2, c: 99.3 }), // pushed away again
  ];
  const { events } = run(bars);
  ok(
    'one break is confirmed once, however often it is retested',
    events.length === 1,
    `got ${events.length}`,
  );
}

{
  /*
   * And the mirror of that rule: a reclaim AFTER a break has already been
   * named is not a fake break. The line printed earlier said the break stuck;
   * "FAKE BREAK" an hour later would contradict it.
   */
  const bars = [bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5 })];
  for (let m = 1; m <= RETEST_TIMEOUT_MINUTES; m += 1) {
    bars.push(bar(m, { o: 99.0, h: 99.1, l: 98.9, c: 99.0 })); // broke-and-left
  }
  // Long after, price climbs back over the level.
  bars.push(bar(90, { o: 99.5, h: 100.4, l: 99.5, c: 100.3 }));

  const { events, state } = run(bars);
  ok(
    'a reclaim after a named break adds no second line',
    events.length === 1,
    `got ${events.map((e) => e.outcome).join(', ')}`,
  );
  ok('but it does re-arm the level', state.status === 'holding');
}

// --- the anti-spam cap -------------------------------------------------------

section('One event per level per fifteen minutes');

{
  /*
   * A level oscillating across the buffer: break, reclaim, break, reclaim, a
   * minute apart. Without the cooldown this is four events about one
   * indecisive price.
   */
  const bars = [];
  for (let pair = 0; pair < 4; pair += 1) {
    bars.push(bar(pair * 2, { o: 100, h: 100.02, l: 99.4, c: 99.5 }));
    bars.push(bar(pair * 2 + 1, { o: 99.5, h: 100.2, l: 99.5, c: 100.15 }));
  }

  const { events } = run(bars);
  ok('an oscillating level reports once, not four times', events.length === 1, `got ${events.length}`);

  // The same sequence spread past the cooldown is allowed to report twice.
  const spaced = [
    bar(0, { o: 100, h: 100.02, l: 99.4, c: 99.5 }),
    bar(1, { o: 99.5, h: 100.2, l: 99.5, c: 100.15 }),
    bar(EVENT_COOLDOWN_MINUTES + 1, { o: 100, h: 100.02, l: 99.4, c: 99.5 }),
    bar(EVENT_COOLDOWN_MINUTES + 2, { o: 99.5, h: 100.2, l: 99.5, c: 100.15 }),
  ];
  ok(
    'past the cooldown, a genuine second event is allowed',
    run(spaced).events.length === 2,
    `got ${run(spaced).events.length}`,
  );
}

// --- the volume flag ---------------------------------------------------------

section('The volume flag describes the breaking bar');

{
  const bars = FAILED_RETEST;
  const quiet = run(bars, { volumeFlag: false });
  const loud = run(bars, { volumeFlag: true });
  ok('a quiet break carries a quiet flag', quiet.events[0]?.volumeAboveAverage === false);
  ok('a heavy break carries a heavy flag', loud.events[0]?.volumeAboveAverage === true);
}

// --- a level that moves ------------------------------------------------------

section('A level that moves is a different level');

{
  const state = initialState({ id: 'flip', price: 100 });
  ok('a level standing still keeps its state', !levelMovedAway(state, 100));
  ok('a hair of drift is tolerated', !levelMovedAway(state, 100.05));
  ok('a real move discards it', levelMovedAway(state, 100.5));
  ok('and so does a move the other way', levelMovedAway(state, 99.5));
}

// --- the words the feed prints -----------------------------------------------

section('Wording');

const W = await import('../src/lib/retest/wording.ts');

/** A finished event, as the machine would hand one over. */
function evt(over = {}) {
  return {
    id: 'x',
    levelId: 'l',
    kind: 'ceiling',
    levelPrice: 770,
    label: 'wall',
    direction: 'down',
    outcome: 'failed-retest',
    brokenAt: '2026-08-28T13:52:00.000Z',
    retestedAt: '2026-08-28T13:58:00.000Z',
    firedAt: '2026-08-28T14:00:00.000Z',
    etClock: '10:00',
    volumeAboveAverage: true,
    breadthPct: 34,
    regime: null,
    ...over,
  };
}

{
  /*
   * The price is composed in one place. A label that also carried the price
   * produced lines reading "770.00 770 wall lost", which is how this check
   * came to exist.
   */
  ok('a whole-number level drops its decimals', W.levelWords(evt()) === '770 wall', W.levelWords(evt()));
  ok(
    'a solved level keeps the decimals it has',
    W.levelWords(evt({ levelPrice: 771.11, label: 'gamma flip' })) === '771.11 gamma flip',
    W.levelWords(evt({ levelPrice: 771.11, label: 'gamma flip' })),
  );
  ok(
    'and one trailing zero goes',
    W.levelWords(evt({ levelPrice: 772.5 })) === '772.5 wall',
    W.levelWords(evt({ levelPrice: 772.5 })),
  );
  ok(
    'no line repeats the price',
    !/770.*770/.test(W.eventLine(evt())),
    W.eventLine(evt()),
  );
}

{
  // The mirrored wording, which is the whole "upside is not an afterthought"
  // requirement expressed in words rather than in logic.
  ok('a downward rejection reads REJECTED', W.outcomeWord(evt()) === 'REJECTED');
  ok(
    'the same event upward reads HELD',
    W.outcomeWord(evt({ direction: 'up' })) === 'HELD',
  );
  ok('a downward break was lost', W.breakWord('down') === 'lost');
  ok('an upward break was taken', W.breakWord('up') === 'taken');
  ok(
    'a fake break reads the same both ways',
    W.outcomeWord(evt({ outcome: 'fake-break' })) ===
      W.outcomeWord(evt({ outcome: 'fake-break', direction: 'up' })),
  );
}

{
  const line = W.eventLine(evt());
  ok('the line carries the break time', line.includes('lost 9:52'), line);
  ok('the retest time', line.includes('retested 9:58'), line);
  ok('the volume flag', line.includes('above-average volume'), line);
  ok('and the breadth reading at the time', line.includes('breadth 34%'), line);

  const noBreadth = W.eventLine(evt({ breadthPct: null }));
  ok('breadth is omitted rather than guessed', !noBreadth.includes('breadth'), noBreadth);

  const noRetest = W.eventLine(evt({ outcome: 'broke-and-left', retestedAt: null }));
  ok('a level never retested says so by omission', !noRetest.includes('retested'), noRetest);
}

{
  // Nothing in the feed may describe the future.
  const forbidden = /(will|should|expect|likely|target|buy|sell|bullish|bearish)/i;
  const samples = [
    W.eventLine(evt()),
    W.eventSentence(evt()),
    W.eventSentence(evt({ direction: 'up' })),
    W.eventSentence(evt({ outcome: 'fake-break' })),
    W.eventSentence(evt({ outcome: 'broke-and-left' })),
    W.regimeSentence(evt({ kind: 'flip', regime: 'calm' })),
    W.regimeSentence(evt({ kind: 'flip', regime: 'wild', direction: 'up' })),
  ];
  for (const text of samples) {
    ok(`no forecast wording: "${String(text).slice(0, 40)}..."`, !forbidden.test(String(text)));
  }

  ok('a non-flip event has no regime line', W.regimeSentence(evt()) === null);
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
