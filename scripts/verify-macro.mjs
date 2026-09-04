/*
 * Validation of the macro translator's reasoning.
 *
 * This is the file that matters most for this feature, because the translator
 * performs small acts of reasoning — a surprise against a convention, a board
 * of overnight votes into one verdict — on a card a reader takes as fact. The
 * checks below are less about exact wording and more about what the wording is
 * never allowed to become: no direction, no forecast, no advice about what to
 * buy or sell. It is a translator, not a sentiment meter.
 *
 * Every branch is walked: both surprise conventions in both signs, in-line via
 * tolerance, the reaction agreeing and disagreeing with the tape, and every way
 * the overnight board can resolve — one-sided, conflicting, quiet, and stale.
 *
 * Run: npm run verify:macro
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const {
  surpriseReading,
  translateRelease,
  reactionNote,
  rowLean,
  rowClause,
  aggregateOvernight,
  signedPct,
  OVERNIGHT_FLAT_PCT,
} = await import('../src/lib/macro/translate.ts');

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

const ev = (over) => ({
  event: 'CPI YoY',
  releaseAt: '2026-09-11T12:30:00Z',
  consensus: 2.9,
  previous: 3.0,
  actual: null,
  unit: '%',
  direction: 'higher_is_tightening',
  ...over,
});

// --- the surprise rule -------------------------------------------------------

section('Surprise is measured against consensus, and the convention applied');

ok(
  'higher CPI than expected tightens',
  surpriseReading(ev({ actual: 3.1 })).reading === 'tightening',
);
ok(
  'lower CPI than expected eases',
  surpriseReading(ev({ actual: 2.7 })).reading === 'easing',
);
ok(
  'higher unemployment than expected eases (higher_is_easing)',
  surpriseReading(
    ev({ direction: 'higher_is_easing', consensus: 4.2, actual: 4.4 }),
  ).reading === 'easing',
);
ok(
  'lower unemployment than expected tightens (higher_is_easing)',
  surpriseReading(
    ev({ direction: 'higher_is_easing', consensus: 4.2, actual: 4.0 }),
  ).reading === 'tightening',
);

ok(
  'the surprise is signed against consensus, not previous',
  // Highest in a year (above previous 3.0) but BELOW consensus 3.2 -> easing.
  surpriseReading(ev({ previous: 3.0, consensus: 3.2, actual: 3.1 })).reading ===
    'easing',
  'a print above previous but below consensus must read as an easing surprise',
);

section('In line is exact, unless a tolerance is set');

ok('exact match is in line', surpriseReading(ev({ actual: 2.9 })).reading === 'in_line');
ok(
  'a hair off with no tolerance is a surprise, not in line',
  surpriseReading(ev({ actual: 2.91 })).reading !== 'in_line',
);
ok(
  'within tolerance is in line',
  surpriseReading(
    ev({ unit: 'K', consensus: 231, actual: 229, inLineTolerance: 3 }),
  ).reading === 'in_line',
);
ok(
  'just past tolerance is a surprise',
  surpriseReading(
    ev({ unit: 'K', consensus: 231, actual: 227, inLineTolerance: 3 }),
  ).reading !== 'in_line',
);

ok(
  'an unreleased event does not throw and reads in line',
  surpriseReading(ev({ actual: null })).reading === 'in_line',
);

// --- the wording -------------------------------------------------------------

section('The release sentence names both figures and the mechanics');

const hot = translateRelease(ev({ actual: 3.1 }));
ok('names the actual', hot.includes('3.1%'), hot);
ok('names the consensus', hot.includes('2.9%'), hot);
ok('names higher than forecast', /higher than forecast/i.test(hot), hot);
ok('states the mechanical tightening', /tightens conditions/i.test(hot), hot);

const pending = translateRelease(ev({ actual: null }));
ok('an unreleased event says there is no reading yet', /no reading/i.test(pending), pending);

// --- reaction: the mechanical reading beside the tape ------------------------

section('The mechanical reading and the tape are shown together, disagreement flagged');

{
  const fights = reactionNote('tightening', 0.6);
  ok('tightening + SPY up is flagged as not textbook', fights.agrees === false, fights.sentence);
  ok('and says so in words', /not the textbook/i.test(fights.sentence), fights.sentence);

  const agrees = reactionNote('tightening', -0.6);
  ok('tightening + SPY down agrees', agrees.agrees === true, agrees.sentence);

  const easingAgrees = reactionNote('easing', 0.6);
  ok('easing + SPY up agrees', easingAgrees.agrees === true, easingAgrees.sentence);

  const flat = reactionNote('tightening', 0.05);
  ok('a flat tape is neither agreement nor disagreement', flat.agrees === null, flat.sentence);

  const noQuote = reactionNote('tightening', null);
  ok('a missing quote is said out loud', noQuote.agrees === null && /no equity-futures quote/i.test(noQuote.sentence), noQuote.sentence);
}

// --- overnight leans ---------------------------------------------------------

section('Each instrument leans the right way, and small moves lean nothing');

ok('weaker yen (USDJPY up) leans risk-off', rowLean({ key: 'USDJPY', changePct: 0.8 }) === 'risk-off');
ok('rising US 10y leans risk-off', rowLean({ key: 'US10Y', changePct: 1.2 }) === 'risk-off');
ok('stronger Nikkei leans risk-on', rowLean({ key: 'NIKKEI', changePct: 1.0 }) === 'risk-on');
ok('firmer dollar leans risk-off', rowLean({ key: 'DXY', changePct: 0.5 }) === 'risk-off');
ok('lower VIX leans risk-on', rowLean({ key: 'VIX', changePct: -3 }) === 'risk-on');
ok(
  'a move inside the flat band leans nothing',
  rowLean({ key: 'NIKKEI', changePct: OVERNIGHT_FLAT_PCT - 0.01 }) === 'neutral',
);
ok('an unknown key leans nothing', rowLean({ key: 'NOPE', changePct: 5 }) === 'neutral');

// --- the aggregate is allowed, and built, to be unclear ----------------------

section('The overnight aggregate returns mixed on conflict, and often');

{
  const conflict = aggregateOvernight([
    { key: 'NIKKEI', changePct: 1.2 }, // risk-on
    { key: 'DXY', changePct: 0.6 }, // risk-off
  ]);
  ok('conflicting inputs are mixed, not averaged', conflict.aggregate === 'mixed', conflict.sentence);

  const oneSided = aggregateOvernight([
    { key: 'NIKKEI', changePct: 1.2 },
    { key: 'KOSPI', changePct: 0.9 },
  ]);
  ok('a one-sided board is called', oneSided.aggregate === 'risk-on', oneSided.sentence);

  const quiet = aggregateOvernight([
    { key: 'NIKKEI', changePct: 0.05 },
    { key: 'DXY', changePct: -0.02 },
  ]);
  ok('a quiet board is mixed, said as quiet', quiet.aggregate === 'mixed' && /quiet/i.test(quiet.sentence), quiet.sentence);

  const stale = aggregateOvernight([{ key: 'NIKKEI', changePct: 3 }], { stale: true });
  ok('stale short-circuits to mixed regardless of the votes', stale.aggregate === 'mixed', stale.sentence);
  ok('and says the quotes are stale', /stale/i.test(stale.sentence), stale.sentence);
}

// --- nothing here predicts or advises ----------------------------------------

section('No sentence predicts a direction or advises an action');

const DIRECTION =
  /\b(will|should|expect|likely|target|rally|selloff|bullish|bearish)\b|\b(higher|lower)\b(?!\s+(than forecast|confidence))/i;
const ADVICE = /\b(buy|sell|short|long the|reduce|add|enter|exit|take profit|de-risk)\b/i;

const sentences = [
  translateRelease(ev({ actual: 3.1 })),
  translateRelease(ev({ actual: 2.7 })),
  translateRelease(ev({ direction: 'higher_is_easing', consensus: 4.2, actual: 4.4 })),
  translateRelease(ev({ actual: 2.9 })),
  reactionNote('tightening', 0.6).sentence,
  reactionNote('easing', 0.6).sentence,
  reactionNote('tightening', null).sentence,
  aggregateOvernight([{ key: 'NIKKEI', changePct: 1.2 }, { key: 'DXY', changePct: 0.6 }]).sentence,
  aggregateOvernight([{ key: 'NIKKEI', changePct: 1.2 }]).sentence,
  aggregateOvernight([{ key: 'DXY', changePct: 0.6 }]).sentence,
  aggregateOvernight([], { stale: true }).sentence,
  rowClause({ key: 'USDJPY', changePct: 0.8 }),
  rowClause({ key: 'JGB10Y', changePct: 0.8 }),
];

for (const line of sentences) {
  ok(`no direction claim: "${line.slice(0, 46)}…"`, !DIRECTION.test(line), line);
  ok(`no advice: "${line.slice(0, 46)}…"`, !ADVICE.test(line), line);
  ok(`a finished string: "${line.slice(0, 40)}…"`, typeof line === 'string' && line.length > 10, line);
}

// --- signed formatting -------------------------------------------------------

section('Signed percentages read cleanly');

ok('positive gets a plus', signedPct(0.4) === '+0.4%', signedPct(0.4));
ok('negative gets a real minus', signedPct(-0.2) === '−0.2%', signedPct(-0.2));
ok('zero is unsigned', signedPct(0) === '0.0%', signedPct(0));

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
