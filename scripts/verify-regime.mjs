/*
 * Validation of the regime wording in src/lib/regime.ts.
 *
 * The module is imported and is the subject — Node 22.6+ strips the types.
 * It has no imports of its own, so this is a direct check of the strings the
 * site actually shows.
 *
 * Why this file exists: the dashboard once said NEGATIVE while the decision
 * page said WILD, for the same state, and the morning post said "jumpy". The
 * fix was to put every one of those words behind this module. A test is what
 * stops the next surface from composing its own.
 *
 * The /decision regime tile is the interesting case, because it has two inputs
 * rather than one — the option chain and the level event feed — and they can
 * disagree for a refresh or two after the chain is re-solved. All four
 * combinations are checked below:
 *
 *              feed agrees        feed disagrees
 *   calm       CALM  / dampen     CALM  / amber, feed saw WILD
 *   wild       WILD  / amplify    WILD  / amber, feed saw CALM
 *
 * Run: npm run verify:regime
 */

const {
  regimeDisplay,
  regimeGloss,
  regimeLabel,
  regimeOfMood,
  regimeSubLine,
  regimeTone,
  regimeWord,
} = await import('../src/lib/regime.ts');

let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(name) {
  console.log(`\n${name}`);
}

// --- the words themselves ----------------------------------------------------

section('The label, everywhere');

eq('positive is the calm one', regimeWord('positive'), 'CALM');
eq('negative is the wild one', regimeWord('negative'), 'WILD');
eq('plain word first, technical in brackets', regimeLabel('positive'), 'CALM (positive gamma)');
eq('and the same shape for the other', regimeLabel('negative'), 'WILD (negative gamma)');
eq('the gloss on its own', regimeGloss('negative'), 'negative gamma');

eq('positive dampens', regimeSubLine('positive'), 'dealers dampen moves');
eq('negative amplifies', regimeSubLine('negative'), 'dealers amplify moves');

eq('positive keeps its colour', regimeTone('positive'), 'pos');
eq('negative keeps its colour', regimeTone('negative'), 'neg');

eq('a calm mood is positive gamma', regimeOfMood('calm'), 'positive');
eq('a wild mood is negative gamma', regimeOfMood('wild'), 'negative');

{
  /*
   * The bug this whole module exists to prevent: one state, two names. Every
   * accessor must agree about which word goes with which regime.
   */
  for (const regime of ['positive', 'negative']) {
    const word = regimeWord(regime);
    ok(
      `${regime}: the label starts with the same word the short form gives`,
      regimeLabel(regime).startsWith(word),
      regimeLabel(regime),
    );
    ok(
      `${regime}: the label carries its own regime name, not the other one`,
      regimeLabel(regime).includes(regime),
      regimeLabel(regime),
    );
  }

  ok(
    'the two labels are not the same string',
    regimeLabel('positive') !== regimeLabel('negative'),
  );
  ok(
    'and neither label contains the other regime word',
    !regimeLabel('positive').includes('WILD') &&
      !regimeLabel('negative').includes('CALM'),
  );
}

// --- the four cases of the /decision tile ------------------------------------

section('The decision tile: calm/wild x feed agrees/disagrees');

{
  // 1. Calm, and nothing to disagree with it.
  const calmAlone = regimeDisplay('positive', null);
  eq('calm, no feed: value', calmAlone.value, 'CALM (positive gamma)');
  eq('calm, no feed: sub', calmAlone.sub, 'dealers dampen moves');
  eq('calm, no feed: tone', calmAlone.tone, 'pos');
  ok('calm, no feed: not flagged', calmAlone.disagrees === false);

  // 2. Wild, and nothing to disagree with it.
  const wildAlone = regimeDisplay('negative', null);
  eq('wild, no feed: value', wildAlone.value, 'WILD (negative gamma)');
  eq('wild, no feed: sub', wildAlone.sub, 'dealers amplify moves');
  eq('wild, no feed: tone', wildAlone.tone, 'neg');
  ok('wild, no feed: not flagged', wildAlone.disagrees === false);

  // 3. Chain says calm, the feed last confirmed a flip to wild.
  const calmVsWild = regimeDisplay('positive', 'negative');
  eq('calm vs wild: value stays the chain reading', calmVsWild.value, 'CALM (positive gamma)');
  eq(
    'calm vs wild: sub names the feed reading',
    calmVsWild.sub,
    'Level feed last saw a flip to WILD. The two readings disagree.',
  );
  eq('calm vs wild: tone goes amber', calmVsWild.tone, 'flip');
  ok('calm vs wild: flagged', calmVsWild.disagrees === true);

  // 4. The mirror. Neither direction is the special case.
  const wildVsCalm = regimeDisplay('negative', 'positive');
  eq('wild vs calm: value stays the chain reading', wildVsCalm.value, 'WILD (negative gamma)');
  eq(
    'wild vs calm: sub names the feed reading',
    wildVsCalm.sub,
    'Level feed last saw a flip to CALM. The two readings disagree.',
  );
  eq('wild vs calm: tone goes amber', wildVsCalm.tone, 'flip');
  ok('wild vs calm: flagged', wildVsCalm.disagrees === true);
}

{
  /*
   * A feed that agrees is agreement, not a third state. This is the case a
   * naive `observed !== null` check gets wrong, and it is the common one —
   * the two sources agree for almost the whole session.
   */
  const calmAgreed = regimeDisplay('positive', 'positive');
  eq('feed agreeing reads as agreement, not conflict', calmAgreed.tone, 'pos');
  eq('and says the ordinary sub-line', calmAgreed.sub, 'dealers dampen moves');
  ok('and is not flagged', calmAgreed.disagrees === false);

  const wildAgreed = regimeDisplay('negative', 'negative');
  eq('the same the other way', wildAgreed.tone, 'neg');
  ok('and not flagged either', wildAgreed.disagrees === false);
}

{
  // Omitting the second argument must behave as "no feed reading", not as a
  // disagreement with undefined.
  ok(
    'the parameter is optional and defaults to no reading',
    regimeDisplay('positive').disagrees === false &&
      regimeDisplay('positive').sub === regimeSubLine('positive'),
  );
}

{
  /*
   * The tile must never compose its own words. Whatever the case, the value it
   * shows has to be a string this module produced for one of the two regimes.
   */
  const allowed = new Set([regimeLabel('positive'), regimeLabel('negative')]);
  for (const chain of ['positive', 'negative']) {
    for (const observed of [null, 'positive', 'negative']) {
      const shown = regimeDisplay(chain, observed);
      ok(
        `value for ${chain}/${observed ?? 'none'} is a label from this module`,
        allowed.has(shown.value),
        shown.value,
      );
      ok(
        `sub for ${chain}/${observed ?? 'none'} is non-empty`,
        typeof shown.sub === 'string' && shown.sub.length > 0,
      );
    }
  }
}

{
  // Nothing on this tile may predict anything.
  const forbidden = /\b(will|should|expect|likely|target|buy|sell|bullish|bearish)\b/i;
  for (const chain of ['positive', 'negative']) {
    for (const observed of [null, 'positive', 'negative']) {
      const { value, sub } = regimeDisplay(chain, observed);
      ok(
        `no forecast wording for ${chain}/${observed ?? 'none'}`,
        !forbidden.test(value) && !forbidden.test(sub),
        `${value} / ${sub}`,
      );
    }
  }
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
