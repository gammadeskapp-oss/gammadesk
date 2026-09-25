/*
 * Validation of the X auto-poster's pure logic: OAuth 1.0a signing, the
 * Chicago-clock schedule gates, the post-text composers, and the pre-post
 * self-checks. These are the parts a wrong change would break silently — a
 * mis-signed request, a post that drifts off schedule across DST, a rule
 * violation reaching @GammadeskHQ, or a bad number going out.
 *
 * The IO-bound pieces (the live tweet POST, the Blob log, the getPositioning /
 * Cboe fetches) are exercised separately by the sample-post dry runs against
 * prod data; they import `server-only` and cannot run here.
 *
 * Run: npm run verify:x-poster
 */

import { createHmac } from 'node:crypto';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { buildAuthHeader, classify, rfc3986 } = await import('../src/lib/x/oauth.ts');
const {
  chicagoNow,
  isTradingDay,
  isEarlyClose,
  isPostingDay,
  dueMorningSlot,
  dueClosingSlot,
  dueWeeklySlot,
  dueEarningsSlot,
  mostRecentFriday,
  formatClockCt,
} = await import('../src/lib/x/schedule.ts');
const {
  PHRASES,
  MOVERS,
  AT_LEVEL,
  WILD_INDICES,
  pickSituation,
  render,
  composeIntradayPhrase,
  phraseId,
  NEAR_PCT,
} = await import('../src/lib/x/phrases.ts');
const {
  nextAction,
  shouldAutoResume,
  summariseDay,
  consecutiveSkips,
  marketHoursStaleAlarm,
} = await import('../src/lib/x/dispatch.ts');
const { phraseUsage } = await import('../src/lib/x/intradaySchedule.ts');
const {
  composeMorning: composeMarketMorning,
  composeClosing: composeMarketClosing,
  composeIntradayFallback,
  finishIntraday,
  changeText,
  dayChangeWords,
  roundLevel,
  moodEmoji,
  money,
  xLen,
  plainEnglish,
  checkPost,
  countCashtags,
  limitCashtags,
  ageMinutes,
  stalestIso,
  MAX_DATA_AGE_MIN,
  NFA,
  DAILY_LINK: MARKET_DAILY_LINK,
} = await import('../src/lib/x/compose.ts');
const {
  inIntradayWindow,
  randomGapMinutes,
  nextDueAfter,
  pendingTrigger,
  decideIntraday,
  applyLockedLevels,
  lockableLevels,
} = await import('../src/lib/x/intradaySchedule.ts');
const { checkText, checkNumbers } = await import('../src/lib/x/guard.ts');
const { postingEnabledFromValue } = await import('../src/lib/x/flags.ts');
const { decodeImageField, selectImagesToDelete, MAX_IMAGE_BYTES } = await import('../src/lib/x/media.ts');
const {
  composeMorning,
  composeGamma,
  composePulse,
  composeClosing,
  composeBriefMorning,
  composeFallbackMorning,
  composeClosingBrief,
  composeWeeklyBrief,
  validateWeeklyBrief,
  composeEarningsPost,
  selectEarningsNames,
  extractTicker,
  validateBrief,
  validateClosingBrief,
  signedPoints,
  vixWord,
  X_LIMIT,
  DISCLAIMER,
  DAILY_LINK,
} = await import('../src/lib/x/text.ts');

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

// --- OAuth 1.0a signing (the Twitter worked example) -------------------------

section('OAuth 1.0a signing matches RFC 5849 (Twitter worked example inputs)');

// The Twitter "Creating a signature" example fixes every input, so its exact
// signature base string is known. Correctness of an OAuth 1.0a signer IS the
// base string plus a standard HMAC-SHA1 — so the header's signature must equal
// the HMAC of that canonical base string. Asserting against an independently
// computed HMAC (not a copied magic constant) proves the base string my code
// builds is byte-for-byte the documented one.
{
  const creds = {
    apiKey: 'xvz1evFS4wEEPTGEFPHBog',
    apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7v',
    accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  };

  // The canonical base string from RFC 5849 §3.4.1 for these inputs.
  const canonicalBase =
    'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json' +
    '&include_entities%3Dtrue' +
    '%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog' +
    '%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg' +
    '%26oauth_signature_method%3DHMAC-SHA1' +
    '%26oauth_timestamp%3D1318622958' +
    '%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb' +
    '%26oauth_version%3D1.0' +
    '%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signal%2520was%2520received%2521';
  const signingKey = `${rfc3986(creds.apiSecret)}&${rfc3986(creds.accessSecret)}`;
  const expected = createHmac('sha1', signingKey).update(canonicalBase).digest('base64');

  const header = buildAuthHeader(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json',
    creds,
    { status: 'Hello Ladies + Gentlemen, a signal was received!', include_entities: 'true' },
    'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    '1318622958',
  );
  ok(
    'signature equals HMAC-SHA1 of the canonical base string',
    header.includes(`oauth_signature="${rfc3986(expected)}"`),
    `expected ${expected} — header ${header}`,
  );
  ok('header names the consumer key', header.includes('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"'));
  ok('header carries HMAC-SHA1', header.includes('oauth_signature_method="HMAC-SHA1"'));
  ok('header starts with OAuth', header.startsWith('OAuth '));
  // A changed secret must change the signature — guards against a no-op signer.
  const tampered = buildAuthHeader(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json',
    { ...creds, accessSecret: 'different' },
    { status: 'Hello Ladies + Gentlemen, a signal was received!', include_entities: 'true' },
    'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    '1318622958',
  );
  ok('a different secret yields a different signature', !tampered.includes(`oauth_signature="${rfc3986(expected)}"`));
}

section('rfc3986 encodes the reserved characters OAuth cares about');
ok('space → %20', rfc3986('a b') === 'a%20b');
ok('! → %21', rfc3986('!') === '%21');
ok("* ' ( ) encoded", rfc3986("*'()") === '%2A%27%28%29');
ok('unreserved untouched', rfc3986("aZ0-_.~") === 'aZ0-_.~');

section('failure classification: pause ONLY on auth (401/bad creds) or billing');
// The only two kinds that pause the poster:
ok('401 → auth', classify(401, '') === 'auth');
ok('bad-credentials body → auth', classify(403, 'Invalid or expired token') === 'auth');
ok('402 → billing', classify(402, '') === 'billing');
ok('403 (usage cap) → billing', classify(403, 'monthly usage cap reached') === 'billing');
ok('out-of-credit body → billing', classify(403, 'You have exceeded your credit balance') === 'billing');
// Everything else must NOT pause — skip and continue:
ok('403 (permissions) → other, NOT auth', classify(403, 'You are not permitted to perform this action.') === 'other');
ok('403 (duplicate content) → duplicate', classify(403, 'You are not allowed to create a Tweet with duplicate content.') === 'duplicate');
ok('429 → rate', classify(429, '') === 'rate');
ok('500 → other', classify(500, 'boom') === 'other');
ok('timeout-ish 408 → other', classify(408, 'request timeout') === 'other');

// --- Chicago-clock schedule (DST must not shift the posts) -------------------

section('The morning slot is 8:30 CT year-round (fixed template)');

const closedRules = { isClosed: (d) => d === '2026-07-03' }; // a made-up holiday

// Summer: CDT = UTC-5, so 13:30 UTC is 08:30 Central; 14:30 UTC is 09:30.
ok('summer 13:30 UTC → morning', dueMorningSlot(new Date('2026-07-01T13:30:00Z')) !== null);
ok('summer 14:30 UTC → not morning (that is 9:30 CT)', dueMorningSlot(new Date('2026-07-01T14:30:00Z')) === null);
// Winter: CST = UTC-6, so 14:30 UTC is 08:30 Central; 13:30 UTC is 07:30.
ok('winter 14:30 UTC → morning', dueMorningSlot(new Date('2026-01-05T14:30:00Z')) !== null);
ok('winter 13:30 UTC → not morning (that is 7:30 CT)', dueMorningSlot(new Date('2026-01-05T13:30:00Z')) === null);
ok('Saturday → no morning', dueMorningSlot(new Date('2026-07-04T13:30:00Z')) === null);
ok('holiday → no morning', dueMorningSlot(new Date('2026-07-03T13:30:00Z'), closedRules) === null);
ok('morning slot key is stable', dueMorningSlot(new Date('2026-07-01T13:30:00Z')).key === 'morning');

section('isTradingDay knows weekends and holidays');
ok('a weekday trades', isTradingDay('2026-07-01') === true);
ok('Saturday does not', isTradingDay('2026-07-04') === false);
ok('Sunday does not', isTradingDay('2026-07-05') === false);
ok('a holiday does not', isTradingDay('2026-07-03', closedRules) === false);

section('chicagoNow converts a known instant');
{
  const c = chicagoNow(new Date('2026-07-01T14:30:00Z'));
  ok('summer 14:30 UTC → 09:30 CT', c.hour === 9 && c.minute === 30, `${c.hour}:${c.minute}`);
  const w = chicagoNow(new Date('2026-01-05T14:30:00Z'));
  ok('winter 14:30 UTC → 08:30 CT', w.hour === 8 && w.minute === 30, `${w.hour}:${w.minute}`);
}

// --- Self-checks on the text -------------------------------------------------

section('checkText enforces every wording rule');

const goodText = 'SPY at the open 🟡\nBalance point 610 holds.\nas of 09:30 ET\nNot financial advice.';
ok('a clean post passes', checkText(goodText).length === 0, checkText(goodText).join('|'));

ok('missing disclaimer fails', checkText('SPY up. as of 10:00 ET').some((f) => /disclaimer/i.test(f)));
ok('missing "as of ET" fails', checkText(`SPY up. ${DISCLAIMER}`).some((f) => /as of/i.test(f)));
ok('over 280 fails', checkText('x'.repeat(281) + `\nas of 10:00 ET\n${DISCLAIMER}`).some((f) => /Too long/i.test(f)));

for (const [word, sample] of [
  ['buy', `Time to buy SPY. as of 10:00 ET ${DISCLAIMER}`],
  ['sell', `Consider selling now. as of 10:00 ET ${DISCLAIMER}`],
  ['calls', `Grab some calls. as of 10:00 ET ${DISCLAIMER}`],
  ['delayed', `Quotes are delayed. as of 10:00 ET ${DISCLAIMER}`],
  ['live', `Live prices here. as of 10:00 ET ${DISCLAIMER}`],
  ['trade', `A great trade setup. as of 10:00 ET ${DISCLAIMER}`],
]) {
  ok(`banned wording "${word}" is caught`, checkText(sample).some((f) => /banned/i.test(f)));
}
// Plain words that merely contain a banned substring must NOT trip.
ok('"balance"/"above"/"floor" do not trip', checkText(goodText).length === 0);

section('checkNumbers rejects bad figures and implausible jumps');
ok('a clean set passes', checkNumbers({ spot: 610 }, { spot: 611 }).length === 0);
ok('no baseline still passes', checkNumbers({ spot: 610 }, null).length === 0);
ok('a zero fails', checkNumbers({ spot: 0 }, null).some((f) => /sane/i.test(f)));
ok('a NaN fails', checkNumbers({ spot: NaN }, null).some((f) => /sane/i.test(f)));
ok('an empty set fails', checkNumbers({}, null).some((f) => /No figures/i.test(f)));
ok('a 40% jump fails', checkNumbers({ spot: 610 }, { spot: 400 }).some((f) => /jumped/i.test(f)));
ok('a 2% move is fine', checkNumbers({ spot: 610 }, { spot: 600 }).length === 0);
ok('VIX is allowed to swing 50%', checkNumbers({ vix: 30 }, { vix: 20 }).length === 0);

// --- The composers produce compliant posts -----------------------------------

section('Every composer produces a rule-clean post');

const level = {
  spot: 610.25,
  regime: 'positive',
  flipLevel: 608,
  wallAbove: 615,
  floorBelow: 605,
  asOfLabel: '09:30 ET',
  dataIso: '2026-07-01T14:30:00Z',
};

function assertClean(label, composed) {
  const problems = checkText(composed.text);
  ok(`${label}: passes checkText`, problems.length === 0, problems.join(' | '));
  ok(`${label}: within ${X_LIMIT}`, composed.length <= X_LIMIT, String(composed.length));
  ok(`${label}: has figures`, Object.keys(composed.numbers).length > 0);
}

const morning = composeMorning(level);
assertClean('morning', morning);
ok('morning has NO link', !morning.text.includes('gammadesk.app'));

const gamma = composeGamma(level);
assertClean('gamma', gamma);
ok('gamma HAS the link', gamma.text.includes('gammadesk.app'));
ok('gamma link points at the /daily landing page', gamma.text.includes('gammadesk.app/daily'), gamma.text);

const closing = composeClosing({ ...level, spyChangePct: 0.006, spyPrice: 610.25 });
assertClean('closing', closing);
ok('closing has NO link', !closing.text.includes('gammadesk.app'));

const pulse = composePulse(
  {
    spy: { price: 761.7, changePct: 0.004, quoteIso: level.dataIso },
    qqq: { price: 722.0, changePct: 0.006, quoteIso: level.dataIso },
    iwm: { price: 284.1, changePct: -0.001, quoteIso: level.dataIso },
    vix: { price: 14.8, changePct: -0.02, quoteIso: level.dataIso },
  },
  '10:15 ET',
  level.dataIso,
);
assertClean('pulse', pulse);
ok('pulse has NO link', !pulse.text.includes('gammadesk.app'));
ok('pulse names all four majors', /SPY/.test(pulse.text) && /QQQ/.test(pulse.text) && /IWM/.test(pulse.text) && /Volatility/.test(pulse.text));

// Negative regime and a null flip must still compose cleanly.
assertClean('gamma (choppy, no flip)', composeGamma({ ...level, regime: 'negative', flipLevel: null, wallAbove: null, floorBelow: null }));
assertClean('morning (choppy, no flip)', composeMorning({ ...level, regime: 'negative', flipLevel: null }));
assertClean('closing (no SPY quote)', composeClosing({ ...level, spyChangePct: null, spyPrice: null }));

// The pulse must refuse to compose without the three required majors.
ok('pulse without IWM throws', (() => {
  try {
    composePulse({ spy: { price: 1, changePct: 0, quoteIso: level.dataIso }, qqq: { price: 1, changePct: 0, quoteIso: level.dataIso } }, '10:00 ET', level.dataIso);
    return false;
  } catch {
    return true;
  }
})());

section('The X_POSTING_ENABLED kill switch forgives common formatting mistakes');
for (const v of ['true', 'TRUE', ' true ', '"true"', "'true'", 'true\n', '1', 'yes', 'on', 'enabled'])
  ok(`"${v.replace(/\n/g, '\\n')}" enables`, postingEnabledFromValue(v) === true);
for (const v of ['false', '0', 'no', 'off', '', '  ', 'enable', 'truthy', undefined, null])
  ok(`"${String(v)}" stays off`, postingEnabledFromValue(v) === false);

// --- Morning Desk brief ------------------------------------------------------

section('formatClockCt renders the Central clock without a leading zero');
ok('winter 14:30 UTC → 8:30 CT', formatClockCt(new Date('2026-01-05T14:30:00Z')) === '8:30 CT', formatClockCt(new Date('2026-01-05T14:30:00Z')));
ok('summer 13:30 UTC → 8:30 CT', formatClockCt(new Date('2026-07-01T13:30:00Z')) === '8:30 CT', formatClockCt(new Date('2026-07-01T13:30:00Z')));

section('signedPoints and vixWord');
ok('+0.4%', signedPoints(0.4) === '+0.4%');
ok('-1.5%', signedPoints(-1.5) === '-1.5%');
ok('0 → +0.0%', signedPoints(0) === '+0.0%');
ok('vix 14 → calm', vixWord(14) === 'calm');
ok('vix 25 → choppy', vixWord(25) === 'choppy');

section('validateBrief is strict about untrusted input');
const RX = '2026-09-21';
const goodBrief = { date: RX, spy: 0.4, qqq: 0.6, iwm: -0.2, vix: 14.8, topStory: 'Futures firm ahead of jobs data', earningsToday: ['AAPL', 'MSFT', 'NVDA', 'AMD'] };
{
  const r = validateBrief(goodBrief, '2026-09-21T13:00:00Z');
  ok('a valid brief passes', r.ok === true, r.error);
  ok('receivedAt is stamped', r.brief.receivedAt === '2026-09-21T13:00:00Z');
  ok('earnings kept in order', r.brief.earningsToday.join(',') === 'AAPL,MSFT,NVDA,AMD');
}
{
  // A real morning payload: spy/qqq/iwm are PERCENT changes here (small,
  // signed), vix is the level. Distinct field semantics from the closing type.
  const realMorning = {
    type: 'morning', date: '2026-09-18', spy: 0.11, qqq: 0.2, iwm: -0.3,
    vix: 15.2, topStory: 'Futures firm ahead of the open.',
    earningsToday: ['NVDA', 'AAPL'],
  };
  const r = validateBrief(realMorning, '2026-09-18T13:00:00Z');
  ok('real morning payload passes', r.ok === true, r.error);
  ok('morning spy kept as a percent', r.brief?.spy === 0.11, String(r.brief?.spy));
  // A price-sized value in a morning payload IS an implausible percent move,
  // and the error must name the field and say why.
  const bad = validateBrief({ ...realMorning, spy: 761.56 }, 'x');
  ok('price-sized morning spy is rejected as implausible', bad.ok === false);
  ok('rejection names spy and explains why', /spy/.test(bad.error ?? '') && /implausible/.test(bad.error ?? ''), bad.error);
}
ok('bad date rejected', validateBrief({ ...goodBrief, date: '9/21/2026' }, 'x').ok === false);
ok('missing date rejected', validateBrief({ ...goodBrief, date: undefined }, 'x').ok === false);
ok('non-number spy rejected', validateBrief({ ...goodBrief, spy: 'up' }, 'x').ok === false);
ok('NaN qqq rejected', validateBrief({ ...goodBrief, qqq: NaN }, 'x').ok === false);
ok('implausible move rejected', validateBrief({ ...goodBrief, spy: 40 }, 'x').ok === false);
ok('vix 0 rejected', validateBrief({ ...goodBrief, vix: 0 }, 'x').ok === false);
ok('vix 300 rejected', validateBrief({ ...goodBrief, vix: 300 }, 'x').ok === false);
ok('empty topStory rejected', validateBrief({ ...goodBrief, topStory: '   ' }, 'x').ok === false);
ok('earnings not-array rejected', validateBrief({ ...goodBrief, earningsToday: 'AAPL' }, 'x').ok === false);
ok('earnings with non-string rejected', validateBrief({ ...goodBrief, earningsToday: ['AAPL', 3] }, 'x').ok === false);
ok('non-object rejected', validateBrief('nope', 'x').ok === false);
ok('null rejected', validateBrief(null, 'x').ok === false);
{
  const r = validateBrief({ ...goodBrief, earningsToday: [' AAPL ', '', 'MSFT'] }, 'x');
  ok('earnings trimmed and blanks dropped', r.brief.earningsToday.join(',') === 'AAPL,MSFT');
}

section('composeBriefMorning is rule-clean and CT-stamped');
{
  const brief = validateBrief(goodBrief, '2026-09-21T13:25:00Z').brief;
  const p = composeBriefMorning(brief, '8:25 CT');
  const problems = checkText(p.text);
  ok('passes checkText (CT accepted)', problems.length === 0, problems.join(' | '));
  ok('within 280', p.length <= X_LIMIT, String(p.length));
  ok('opens with the greeting', p.text.startsWith('Good morning ☕ Before the open:'));
  ok('shows SPY/QQQ/VIX with a calm word', /SPY \+0\.4% · QQQ \+0\.6% · VIX 14\.8 \(calm\)/.test(p.text));
  ok('shows the top story', p.text.includes('Futures firm ahead of jobs data'));
  ok('caps earnings at 3', /Earnings today: AAPL, MSFT, NVDA/.test(p.text) && !p.text.includes('AMD'));
  ok('has NO link', !p.text.includes('gammadesk.app'));
  ok('stamped in CT', p.text.includes('as of 8:25 CT'));
  ok('sanity number is vix only', JSON.stringify(p.numbers) === '{"vix":14.8}');
}
{
  // A very long story must be trimmed to fit rather than overrun.
  const long = validateBrief({ ...goodBrief, topStory: 'x'.repeat(500) }, 'x').brief;
  const p = composeBriefMorning(long, '8:25 CT');
  ok('long story trimmed to fit 280', p.length <= X_LIMIT, String(p.length));
  ok('trim leaves the disclaimer intact', p.text.includes(DISCLAIMER));
  ok('trim leaves the CT stamp intact', p.text.includes('as of 8:25 CT'));
}
{
  // No earnings → the line is omitted, still clean.
  const noe = validateBrief({ ...goodBrief, earningsToday: [] }, 'x').brief;
  const p = composeBriefMorning(noe, '8:25 CT');
  ok('no-earnings brief still clean', checkText(p.text).length === 0);
  ok('no-earnings omits the earnings line', !p.text.includes('Earnings today'));
}

section('composeFallbackMorning covers the missing-brief path');
{
  const q = { price: 761.7, changePct: 0.004, quoteIso: '2026-09-21T13:20:00Z' };
  const p = composeFallbackMorning({ spy: q, qqq: { ...q, changePct: 0.006 }, vix: { ...q, price: 14.8 } }, '8:25 CT', q.quoteIso);
  ok('fallback passes checkText', checkText(p.text).length === 0, checkText(p.text).join(' | '));
  ok('fallback within 280', p.length <= X_LIMIT);
  ok('fallback carries the brief-missing note', p.note === 'brief missing');
  ok('fallback has NO link', !p.text.includes('gammadesk.app'));
  ok('fallback needs SPY/QQQ/VIX', (() => { try { composeFallbackMorning({ spy: q }, '8:25 CT', 'x'); return false; } catch { return true; } })());
}

// --- Closing Bell brief ------------------------------------------------------

section('The closing slot fires at 3:20 PM CT in both summer and winter');
// Summer (CDT, UTC-5): 20:20 UTC is 15:20 CT.
ok('summer 20:20 UTC → closing', dueClosingSlot(new Date('2026-07-01T20:20:00Z'))?.key === 'closing');
ok('summer 21:20 UTC → null (4:20 CT)', dueClosingSlot(new Date('2026-07-01T21:20:00Z')) === null);
// Winter (CST, UTC-6): 21:20 UTC is 15:20 CT.
ok('winter 21:20 UTC → closing', dueClosingSlot(new Date('2026-01-05T21:20:00Z'))?.key === 'closing');
ok('winter 20:20 UTC → null (2:20 CT)', dueClosingSlot(new Date('2026-01-05T20:20:00Z')) === null);
ok('weekend → no closing', dueClosingSlot(new Date('2026-07-04T20:20:00Z')) === null);
ok('holiday → no closing', dueClosingSlot(new Date('2026-07-03T20:20:00Z'), closedRules) === null);

section('validateClosingBrief is strict about untrusted input');
const goodClosing = {
  type: 'closing', date: RX, spy: 761.7, spyChangePct: 0.4, qqq: 722.0, qqqChangePct: 0.6,
  iwm: 284.1, iwmChangePct: -0.5, vix: 14.8, dayStory: 'Rally into the close on soft PPI',
  topMovers: ['NVDA', 'AAPL', 'TSLA', 'AMD'],
};
{
  const r = validateClosingBrief(goodClosing, '2026-09-21T20:20:00Z');
  ok('a valid closing brief passes', r.ok === true, r.error);
  ok('receivedAt stamped', r.brief.receivedAt === '2026-09-21T20:20:00Z');
  ok('movers kept in order', r.brief.topMovers.join(',') === 'NVDA,AAPL,TSLA,AMD');
}
{
  // The exact real closing payload Cowork sends. `spy` etc. are PRICES here,
  // not percents — this must pass, and the price levels must survive unchanged
  // (a regression guard against ever re-validating closing `spy` as a percent).
  const real = {
    type: 'closing', date: '2026-09-18', spy: 761.56, spyChangePct: 0.11,
    qqq: 721.08, qqqChangePct: 0.2, iwm: 244.3, iwmChangePct: -0.3, vix: 15.2,
    dayStory: 'Stocks drifted higher into the close on light volume.',
    topMovers: ['NVDA +2%', 'AAPL -1%'],
  };
  const r = validateClosingBrief(real, '2026-09-18T20:20:00Z');
  ok('real Cowork closing payload passes', r.ok === true, r.error);
  ok('closing spy kept as a price level', r.brief?.spy === 761.56, String(r.brief?.spy));
  ok('closing spyChangePct kept as a percent', r.brief?.spyChangePct === 0.11, String(r.brief?.spyChangePct));
}
ok('bad date rejected', validateClosingBrief({ ...goodClosing, date: 'x' }, 'x').ok === false);
ok('non-positive spy level rejected', validateClosingBrief({ ...goodClosing, spy: 0 }, 'x').ok === false);
ok('negative iwm level rejected', validateClosingBrief({ ...goodClosing, iwm: -1 }, 'x').ok === false);
ok('non-number spyChangePct rejected', validateClosingBrief({ ...goodClosing, spyChangePct: 'up' }, 'x').ok === false);
ok('implausible change rejected', validateClosingBrief({ ...goodClosing, qqqChangePct: 40 }, 'x').ok === false);
ok('negative change is fine', validateClosingBrief({ ...goodClosing, iwmChangePct: -0.5 }, 'x').ok === true);
ok('vix out of range rejected', validateClosingBrief({ ...goodClosing, vix: 0 }, 'x').ok === false);
ok('empty dayStory rejected', validateClosingBrief({ ...goodClosing, dayStory: ' ' }, 'x').ok === false);
ok('topMovers not-array rejected', validateClosingBrief({ ...goodClosing, topMovers: 'NVDA' }, 'x').ok === false);
{
  const r = validateClosingBrief({ ...goodClosing, topMovers: [' NVDA ', '', 'AAPL'] }, 'x');
  ok('movers trimmed and blanks dropped', r.brief.topMovers.join(',') === 'NVDA,AAPL');
}

section('composeClosingBrief is rule-clean and stamped "as of market close"');
{
  const brief = validateClosingBrief(goodClosing, '2026-09-21T20:20:00Z').brief;
  const p = composeClosingBrief(brief);
  const problems = checkText(p.text);
  ok('passes checkText ("market close" accepted)', problems.length === 0, problems.join(' | '));
  ok('within 280', p.length <= X_LIMIT, String(p.length));
  ok('opens with the closing bell', p.text.startsWith('Closing bell 🔔'));
  ok('shows the three index changes', /SPY \+0\.4% · QQQ \+0\.6% · IWM -0\.5%/.test(p.text));
  ok('shows VIX with a calm word', /VIX 14\.8 \(calm\)/.test(p.text));
  ok('shows the day story', p.text.includes('Rally into the close on soft PPI'));
  ok('caps movers at 3', /Top movers: NVDA, AAPL, TSLA/.test(p.text) && !p.text.includes('AMD'));
  ok('stamped market close', p.text.includes('as of market close'));
  ok('has NO link', !p.text.includes('gammadesk.app'));
  ok('has NO clock stamp', !/\bET\b/.test(p.text) && !/\bCT\b/.test(p.text));
  ok('sanity numbers are the four positive levels', JSON.stringify(p.numbers) === '{"spy":761.7,"qqq":722,"iwm":284.1,"vix":14.8}');
}
{
  const long = validateClosingBrief({ ...goodClosing, dayStory: 'y'.repeat(500) }, 'x').brief;
  const p = composeClosingBrief(long);
  ok('long story trimmed to fit 280', p.length <= X_LIMIT, String(p.length));
  ok('trim keeps the disclaimer', p.text.includes(DISCLAIMER));
  ok('trim keeps the market-close stamp', p.text.includes('as of market close'));
}
{
  const noMovers = validateClosingBrief({ ...goodClosing, topMovers: [] }, 'x').brief;
  const p = composeClosingBrief(noMovers);
  ok('no-movers closing still clean', checkText(p.text).length === 0);
  ok('no-movers omits the movers line', !p.text.includes('Top movers'));
}

// --- poster image handling ---------------------------------------------------

section('decodeImageField validates the optional base64 PNG');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const validPng = Buffer.concat([PNG_SIG, Buffer.from('some-image-data')]).toString('base64');

ok('omitted image is ok (optional)', decodeImageField(undefined).ok === true && !decodeImageField(undefined).bytes);
ok('null image is ok', decodeImageField(null).ok === true);
ok('empty string is ok (no image)', decodeImageField('').ok === true && !decodeImageField('').bytes);
{
  const r = decodeImageField(validPng);
  ok('a valid PNG decodes', r.ok === true && !!r.bytes, r.error);
  ok('mime is image/png', r.mime === 'image/png');
  ok('first byte is the PNG signature', r.bytes[0] === 0x89);
}
ok('a data: URL prefix is stripped', decodeImageField(`data:image/png;base64,${validPng}`).ok === true);
ok('a non-string image is rejected', decodeImageField(123).ok === false);
ok('a non-PNG payload is rejected', decodeImageField(Buffer.from('hello world, not a png').toString('base64')).ok === false);
{
  // Over 5 MB is rejected. Build just past the limit with a real PNG signature.
  const big = Buffer.concat([PNG_SIG, Buffer.alloc(MAX_IMAGE_BYTES)]).toString('base64');
  const r = decodeImageField(big);
  ok('an over-5MB image is rejected', r.ok === false && /exceeds 5 MB/.test(r.error ?? ''), r.error);
}

section('selectImagesToDelete retires only posted images past the age limit');
{
  const now = Date.parse('2026-09-20T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const entries = [
    { date: 'a', type: 'morning', receivedAt: new Date(now - 8 * day).toISOString(), size: 1, posted: true },   // old + posted -> delete
    { date: 'b', type: 'closing', receivedAt: new Date(now - 8 * day).toISOString(), size: 1, posted: false },  // old + UNPOSTED -> keep
    { date: 'c', type: 'morning', receivedAt: new Date(now - 2 * day).toISOString(), size: 1, posted: true },   // recent + posted -> keep
    { date: 'd', type: 'closing', receivedAt: new Date(now - 2 * day).toISOString(), size: 1, posted: false },  // recent + unposted -> keep
    { date: 'e', type: 'morning', receivedAt: 'not-a-date', size: 1, posted: true },                            // bad date -> keep
  ];
  const del = selectImagesToDelete(entries, now, 7).map((e) => e.date);
  ok('only the old posted image is selected', del.length === 1 && del[0] === 'a', del.join(','));
  ok('an old UNPOSTED image is never deleted', !del.includes('b'));
  ok('a recent posted image is kept', !del.includes('c'));
  ok('a bad-timestamp image is kept', !del.includes('e'));
}

// --- Weekly "Week in review" brief -------------------------------------------

section('The weekly slot fires only at 5:00 PM CT on a Sunday');
// Summer (CDT, UTC-5): 22:00 UTC Sunday is 17:00 CT Sunday.
ok('summer 22:00 UTC Sun → weekly', dueWeeklySlot(new Date('2026-07-05T22:00:00Z'))?.key === 'weekly');
ok('summer 23:00 UTC Sun → null (6 PM CT)', dueWeeklySlot(new Date('2026-07-05T23:00:00Z')) === null);
// Winter (CST, UTC-6): 23:00 UTC Sunday is 17:00 CT Sunday.
ok('winter 23:00 UTC Sun → weekly', dueWeeklySlot(new Date('2026-01-04T23:00:00Z'))?.key === 'weekly');
ok('winter 22:00 UTC Sun → null (4 PM CT)', dueWeeklySlot(new Date('2026-01-04T22:00:00Z')) === null);
ok('Saturday 5 PM CT → no weekly', dueWeeklySlot(new Date('2026-07-04T22:00:00Z')) === null);
ok('a weekday 5 PM CT → no weekly', dueWeeklySlot(new Date('2026-07-01T22:00:00Z')) === null);

section('mostRecentFriday returns the Friday the week closed on');
ok('Sunday → the Friday two days back', mostRecentFriday(new Date('2026-07-05T22:00:00Z')) === '2026-07-03', mostRecentFriday(new Date('2026-07-05T22:00:00Z')));
ok('the Friday itself → that Friday', mostRecentFriday(new Date('2026-07-03T18:00:00Z')) === '2026-07-03');

section('validateWeeklyBrief is strict about untrusted input');
const goodWeekly = {
  type: 'weekly', weekEnding: '2026-09-18', spyWeekPct: 1.2, qqqWeekPct: 0.8, iwmWeekPct: -0.4,
  vix: 15.2, weekStory: 'Stocks ground higher on cooling inflation.',
  nextWeek: ['Fed minutes', 'NVDA earnings', 'PMIs', 'Jobless claims'],
};
{
  const r = validateWeeklyBrief(goodWeekly, '2026-09-20T22:00:00Z');
  ok('a valid weekly brief passes', r.ok === true, r.error);
  ok('receivedAt stamped', r.brief.receivedAt === '2026-09-20T22:00:00Z');
  ok('nextWeek kept in order', r.brief.nextWeek.join(',') === 'Fed minutes,NVDA earnings,PMIs,Jobless claims');
}
ok('bad weekEnding rejected', validateWeeklyBrief({ ...goodWeekly, weekEnding: '9/18/26' }, 'x').ok === false);
ok('non-number spyWeekPct rejected', validateWeeklyBrief({ ...goodWeekly, spyWeekPct: 'up' }, 'x').ok === false);
ok('negative week change is fine', validateWeeklyBrief({ ...goodWeekly, iwmWeekPct: -3.1 }, 'x').ok === true);
ok('implausible week move rejected', validateWeeklyBrief({ ...goodWeekly, spyWeekPct: 60 }, 'x').ok === false);
ok('vix out of range rejected', validateWeeklyBrief({ ...goodWeekly, vix: 0 }, 'x').ok === false);
ok('empty weekStory rejected', validateWeeklyBrief({ ...goodWeekly, weekStory: '  ' }, 'x').ok === false);
ok('nextWeek not-array rejected', validateWeeklyBrief({ ...goodWeekly, nextWeek: 'Fed' }, 'x').ok === false);

section('composeWeeklyBrief matches the required shape and links to /daily');
{
  const brief = validateWeeklyBrief(goodWeekly, '2026-09-20T22:00:00Z').brief;
  const p = composeWeeklyBrief(brief);
  // Editorial post: no "as of" stamp required, but every other rule applies.
  const problems = checkText(p.text, { requireStamp: false });
  ok('passes checkText (no-stamp mode)', problems.length === 0, problems.join(' | '));
  ok('within 280', p.length <= X_LIMIT, String(p.length));
  ok('opens with "Week in review 📅"', p.text.startsWith('Week in review 📅'));
  ok('shows the three week changes', /SPY \+1\.2% · QQQ \+0\.8% · IWM -0\.4%/.test(p.text));
  ok('shows the week story', p.text.includes('Stocks ground higher on cooling inflation.'));
  ok('caps next-week watch items at 3', /Next week: Fed minutes, NVDA earnings, PMIs/.test(p.text) && !p.text.includes('Jobless claims'));
  ok('ends with the /daily link + disclaimer', p.text.endsWith(`${DAILY_LINK} · ${DISCLAIMER}`), p.text);
  ok('has NO clock stamp', !/\bas of\b/i.test(p.text));
  ok('sanity number is vix only', JSON.stringify(p.numbers) === '{"vix":15.2}');
  ok('image key is the week-ending date', p.image && p.image.date === '2026-09-18' && p.image.type === 'weekly');
}
{
  const long = validateWeeklyBrief({ ...goodWeekly, weekStory: 'z'.repeat(500) }, 'x').brief;
  const p = composeWeeklyBrief(long);
  ok('long week story trimmed to fit 280', p.length <= X_LIMIT, String(p.length));
  ok('trim keeps the disclaimer', p.text.includes(DISCLAIMER));
}

// --- Earnings-day post -------------------------------------------------------

section('The earnings slot fires at 7:30 AM CT on a trading day');
// Summer (CDT, UTC-5): 12:30 UTC is 7:30 CT.
ok('summer 12:30 UTC → earnings', dueEarningsSlot(new Date('2026-07-01T12:30:00Z'))?.key === 'earnings');
ok('summer 13:30 UTC → null (8:30 CT)', dueEarningsSlot(new Date('2026-07-01T13:30:00Z')) === null);
// Winter (CST, UTC-6): 13:30 UTC is 7:30 CT.
ok('winter 13:30 UTC → earnings', dueEarningsSlot(new Date('2026-01-05T13:30:00Z'))?.key === 'earnings');
ok('winter 12:30 UTC → null (6:30 CT)', dueEarningsSlot(new Date('2026-01-05T12:30:00Z')) === null);
ok('weekend → no earnings', dueEarningsSlot(new Date('2026-07-04T12:30:00Z')) === null);
ok('holiday → no earnings', dueEarningsSlot(new Date('2026-07-03T12:30:00Z'), closedRules) === null);

section('extractTicker and selectEarningsNames pick well-known names only');
ok('bare ticker', extractTicker('AAPL') === 'AAPL');
ok('ticker with a note', extractTicker('AAPL (after the bell)') === 'AAPL');
ok('name with ticker in parens', extractTicker('Apple (AAPL)') === 'AAPL');
ok('unknown shape → null-ish', extractTicker('') === null);
{
  const picks = selectEarningsNames(['AAPL (after the bell)', 'ZZZZ Corp', 'MSFT', 'AAPL', 'NVDA', 'TSLA'], 3);
  ok('keeps only megacaps, deduped, capped at 3', picks.map((p) => p.ticker).join(',') === 'AAPL,MSFT,NVDA', picks.map((p) => p.ticker).join(','));
  ok('preserves the original display (with the bell note)', picks[0].display === 'AAPL (after the bell)');
}
ok('a small-cap-only list yields nothing', selectEarningsNames(['SMALLCO (SMCX)', 'Tiny Inc (TNY)']).length === 0);

section('composeEarningsPost is rule-clean, prediction-free and links to /daily');
{
  const p = composeEarningsPost(['AAPL (after the bell)', 'MSFT', 'NVDA'], 'Wed 7:30 ET', '2026-09-16T12:25:00Z', { date: '2026-09-16', type: 'earnings' });
  const problems = checkText(p.text, { requireStamp: false });
  ok('passes checkText (no-stamp mode)', problems.length === 0, problems.join(' | '));
  ok('within 280', p.length <= X_LIMIT, String(p.length));
  ok('opens with "Earnings today 📊"', p.text.startsWith('Earnings today 📊'));
  ok('names the three companies', /AAPL/.test(p.text) && /MSFT/.test(p.text) && /NVDA/.test(p.text));
  ok('ends with the /daily link + disclaimer', p.text.endsWith(`${DAILY_LINK} · ${DISCLAIMER}`));
  ok('carries no figures', JSON.stringify(p.numbers) === '{}');
  ok('no banned wording (no buy/sell/expected-move)', checkText(p.text, { requireStamp: false }).every((f) => !/banned/i.test(f)));
  ok('image key is the trading date', p.image && p.image.date === '2026-09-16' && p.image.type === 'earnings');
}

// --- Reworked poster: formatting, fixed templates, intraday cadence ----------

section('changeText: one decimal, ▲/▼, never -0.0%');
ok('+0.4% → ▲0.4%', changeText(0.004) === '▲0.4%', changeText(0.004));
ok('-1.2% → ▼1.2%', changeText(-0.012) === '▼1.2%', changeText(-0.012));
ok('flat → 0.0%', changeText(0) === '0.0%');
ok('a -0.04% that rounds to zero → 0.0% (never -0.0%)', changeText(-0.0004) === '0.0%', changeText(-0.0004));
ok('money to two decimals', money(773.4) === '773.40');
ok('moodEmoji calm → 🟡', moodEmoji('calm') === '🟡');
ok('moodEmoji wild → 🔴', moodEmoji('wild') === '🔴');

section('xLen counts the gammadesk.app link as 23');
ok('a bare link weighs 23', xLen('gammadesk.app/daily') === 23, String(xLen('gammadesk.app/daily')));
ok('text + link weighs text + 23', xLen(`hi\n${DAILY_LINK}`) === 3 + 23, String(xLen(`hi\n${DAILY_LINK}`)));

const snap = {
  spot: 773.4,
  changePct: 0.004,
  dayHigh: 775.1,
  dayLow: 771.2,
  mood: 'wild',
  resistance: 775,
  support: 772,
  flip: 770,
  strong: [{ symbol: 'META', score: 89 }, { symbol: 'MU', score: 78 }, { symbol: 'NVDA', score: 67 }],
  weak: [{ symbol: 'TSLA', score: 12 }, { symbol: 'F', score: 22 }],
  headline: 'KO: raised its full-year guidance',
  dataIso: new Date().toISOString(),
};

section('composeMorning matches the fixed template and passes every rule');
{
  const p = composeMarketMorning(snap);
  ok('passes checkPost', checkPost(p.text).length === 0, checkPost(p.text).join(' | '));
  ok('within 280 (link-weighted)', p.length <= 280, String(p.length));
  ok('opens with $SPY spot + emoji', p.text.startsWith('$SPY 773.40 this morning 🔴'), p.text.split('\n')[0]);
  ok('has the Mood line', p.text.includes('\nMood: wild'));
  ok('has Wall/Floor', /Wall above: .* · Floor below: /.test(p.text));
  ok('has the "Gets wild only under" line', p.text.includes('Gets wild only under: '));
  ok('has Plain English', p.text.includes('Plain English: '));
  // Only the leading $SPY stays a cashtag; the rest are de-$'d so X accepts the
  // post (max one cashtag). Names still read in full.
  ok('has 💪 Strong with the three names', /💪 Strong: META MU NVDA/.test(p.text));
  ok('has 🐢 Weak with the two names', /🐢 Weak: TSLA F/.test(p.text));
  ok('carries exactly one cashtag', countCashtags(p.text) === 1, String(countCashtags(p.text)));
  ok('ends with disclaimer then /daily link', p.text.endsWith(`${NFA}\n${MARKET_DAILY_LINK}`));
  ok('never a vercel.app link', !/vercel\.app/i.test(p.text));
}

section('composeClosing matches the fixed template');
{
  const held = composeMarketClosing(snap); // spot 773.4 >= flip 770
  ok('passes checkPost', checkPost(held.text).length === 0, checkPost(held.text).join(' | '));
  ok('opens with 🔔 close + change', /^🔔 \$SPY closed 773\.40 \(▲0\.4%\)/.test(held.text), held.text.split('\n')[0]);
  ok('says Held above when spot ≥ flip', held.text.includes('Held above 770 → day read wild'));
  ok('shows the range', held.text.includes('Range today: 771.20–775.10'));
  ok('shows Top and Worst', held.text.includes('💪 Top: META · 🐢 Worst: TSLA'));
  ok('carries exactly one cashtag', countCashtags(held.text) === 1, String(countCashtags(held.text)));
  ok('shows the headline', held.text.includes('📰 KO: raised its full-year guidance'));

  const below = composeMarketClosing({ ...snap, spot: 768 });
  ok('says Closed below when spot < flip', below.text.includes('Closed below 770 → day read wild'));
}

section('limitCashtags keeps the first cashtag and de-$es the rest');
{
  ok('keeps a lone cashtag', limitCashtags('$SPY at 773') === '$SPY at 773');
  ok('de-$es all but the first', limitCashtags('$SPY $META $MU') === '$SPY META MU');
  ok('leaves non-cashtag text alone', limitCashtags('Range 771 to 775') === 'Range 771 to 775');
  ok('handles a class dot ($BRK.B)', limitCashtags('$SPY $BRK.B') === '$SPY BRK.B');
  ok('countCashtags counts them', countCashtags('$SPY $META $MU') === 3);
}

section('Long closing drops the news line first, then the weak line');
{
  const longHeadline = { ...snap, headline: 'X'.repeat(240) };
  const p = composeMarketClosing(longHeadline);
  ok('fits under 280', p.length <= 280, String(p.length));
  ok('the news line was dropped to fit', !p.text.includes('📰'));
}

section('composeIntradayFallback and finishIntraday');
{
  const fb = composeIntradayFallback(snap);
  ok('fallback passes checkPost', checkPost(fb.text).length === 0, checkPost(fb.text).join(' | '));
  ok('fallback names spot + the box', /\$SPY at 773\.40 between 772 and 775\./.test(fb.text));
  ok('fallback ends with the disclaimer', fb.text.endsWith(NFA));

  const fin = finishIntraday('SPY drifting around 773, quiet so far.', snap);
  ok('finish appends the disclaimer once', fin.text === `SPY drifting around 773, quiet so far.\n${NFA}`);
  const doubled = finishIntraday('Holding the floor.\nNot financial advice', snap);
  ok('finish strips a disclaimer the model already added', doubled.text === `Holding the floor.\n${NFA}`);
}

section('checkPost catches the banned words and the vercel.app rule');
for (const [word, sample] of [
  ['buy', `time to buy. ${NFA}`],
  ['sell', `selling now. ${NFA}`],
  ['target', `price target 780. ${NFA}`],
  ['guaranteed', `guaranteed gains. ${NFA}`],
  ['delayed', `quotes delayed. ${NFA}`],
  ['live', `live prices. ${NFA}`],
  ['gamma', `gamma flip below. ${NFA}`],
  ['GEX', `GEX is negative. ${NFA}`],
  ['dealer', `dealers are short. ${NFA}`],
  ['hedging', `hedging flows. ${NFA}`],
  ['hashtag', `nice day #SPY ${NFA}`],
]) {
  ok(`banned "${word}" is caught`, checkPost(sample).some((f) => /banned/i.test(f)), sample);
}
ok('a vercel.app link is rejected', checkPost(`see foo.vercel.app ${NFA}`).some((f) => /vercel/i.test(f)));
ok('missing disclaimer is caught', checkPost('just a market note').some((f) => /disclaimer/i.test(f)));
ok('over 280 is caught', checkPost('x'.repeat(300) + `\n${NFA}`).some((f) => /Too long/i.test(f)));
ok('a clean intraday line passes', checkPost(`SPY hugging 773, quiet. ${NFA}`).length === 0);

section('ageMinutes / the 90-minute freshness gate');
{
  const now = new Date('2026-09-21T15:00:00Z');
  ok('a 30-min-old stamp is ~30', Math.round(ageMinutes('2026-09-21T14:30:00Z', now)) === 30);
  ok('a fresh stamp is under the limit', ageMinutes(new Date(now.getTime() - 10 * 60000).toISOString(), now) < MAX_DATA_AGE_MIN);
  ok('a 2h-old stamp is over the limit', ageMinutes('2026-09-21T13:00:00Z', now) > MAX_DATA_AGE_MIN);
  ok('an unparseable stamp is Infinity', ageMinutes('nonsense', now) === Infinity);
}

section('stalestIso: freshness judged by the oldest feed (stale chain blocks a fresh quote)');
{
  const fresh = '2026-09-24T14:00:00Z';
  const staleChain = '2026-09-23T20:00:00Z';
  ok('picks the older of quote vs chain', stalestIso(fresh, staleChain) === staleChain);
  ok('order does not matter', stalestIso(staleChain, fresh) === staleChain);
  ok('ignores a missing stamp', stalestIso(fresh, null) === fresh && stalestIso(undefined, fresh) === fresh);
  ok('ignores an unparseable stamp', stalestIso('nonsense', fresh) === fresh);
  ok('null when nothing valid', stalestIso(null, undefined, 'nope') === null);
  // A fresh quote carrying an hours-old chain is graded stale by the 90-min gate.
  const now = new Date('2026-09-24T14:30:00Z');
  ok('a fresh quote + stale chain is over the age limit', ageMinutes(stalestIso(fresh, staleChain), now) > MAX_DATA_AGE_MIN);
  ok('two fresh feeds stay under the limit', ageMinutes(stalestIso(fresh, '2026-09-24T14:10:00Z'), now) < MAX_DATA_AGE_MIN);
}

section('plainEnglish reads the box');
ok('between support and resistance', /stuck between .* expect sharp swings\.$/.test(plainEnglish(snap)));

// --- Intraday cadence --------------------------------------------------------

section('inIntradayWindow: 9:00–2:45 CT, summer and winter');
// Summer (CDT, UTC-5): 14:00 UTC = 9:00 CT; 19:45 UTC = 2:45 CT.
ok('summer 14:00 UTC → in window (9:00 CT)', inIntradayWindow(new Date('2026-07-01T14:00:00Z')) === true);
ok('summer 19:45 UTC → in window (2:45 CT)', inIntradayWindow(new Date('2026-07-01T19:45:00Z')) === true);
ok('summer 20:00 UTC → out (3:00 CT)', inIntradayWindow(new Date('2026-07-01T20:00:00Z')) === false);
ok('summer 13:45 UTC → out (8:45 CT)', inIntradayWindow(new Date('2026-07-01T13:45:00Z')) === false);
// Winter (CST, UTC-6): 15:00 UTC = 9:00 CT.
ok('winter 15:00 UTC → in window', inIntradayWindow(new Date('2026-01-05T15:00:00Z')) === true);
ok('winter 20:45 UTC → in window (2:45 CT)', inIntradayWindow(new Date('2026-01-05T20:45:00Z')) === true);

section('randomGapMinutes stays in [30, 45]');
ok('always 30–45', [...Array(200)].every(() => { const g = randomGapMinutes(); return g >= 30 && g <= 45; }));
ok('min bound reachable', randomGapMinutes(() => 0) === 30);
ok('max bound reachable', randomGapMinutes(() => 0.999) === 45);
ok('nextDueAfter adds the gap', (() => {
  const now = new Date('2026-07-01T14:00:00Z');
  const due = Date.parse(nextDueAfter(now, () => 0));
  return due - now.getTime() === 30 * 60000;
})());

section('pendingTrigger fires once per level per day, only past the 0.15% margin');
// flip 770 → margin 770*0.9985 ≈ 768.85. 768 is past it; 769 is not.
ok('spot clearly below flip → below-flip', pendingTrigger({ ...snap, spot: 768, support: 763 }, []) === 'below-flip');
ok('a hair below flip (inside 0.15%) → no trigger', pendingTrigger({ ...snap, spot: 769, support: 763 }, []) === null);
ok('already posted below-flip → skip', pendingTrigger({ ...snap, spot: 768, support: 763 }, ['below-flip']) === null);
// resistance 775 → break needs > 775*1.0015 ≈ 776.16.
ok('spot clearly above resistance → above-resistance', pendingTrigger({ ...snap, spot: 777 }, []) === 'above-resistance');
ok('a hair above resistance (inside 0.15%) → no trigger', pendingTrigger({ ...snap, spot: 776 }, []) === null);
// support 772 → break needs < 772*0.9985 ≈ 770.84; keep flip low so below-support wins.
ok('spot clearly below support (above flip) → below-support', pendingTrigger({ ...snap, spot: 770, flip: 763 }, []) === 'below-support');
ok('a hair below support (inside 0.15%) → no trigger', pendingTrigger({ ...snap, spot: 771, flip: 763 }, []) === null);
ok('inside the range → no trigger', pendingTrigger({ ...snap, spot: 773 }, []) === null);

section('decideIntraday: break fires now; timer gates the rest');
{
  const inWindow = new Date('2026-07-01T15:00:00Z'); // 10:00 CT
  const broke = decideIntraday({ ...snap, spot: 768 }, { date: 'x', nextDueIso: null, triggersPosted: [] }, inWindow);
  ok('a break posts immediately', broke.post === true && broke.trigger === 'below-flip');
  ok('break slot key names the level', broke.slotKey === 'intraday-trigger-below-flip');

  const firstTimed = decideIntraday({ ...snap, spot: 773 }, { date: 'x', nextDueIso: null, triggersPosted: [] }, inWindow);
  ok('first timed update posts when no next-due set', firstTimed.post === true && firstTimed.trigger === null);

  const notYet = decideIntraday(
    { ...snap, spot: 773 },
    { date: 'x', nextDueIso: '2026-07-01T15:30:00Z', triggersPosted: [] },
    inWindow,
  );
  ok('a timed update waits for the gap', notYet.post === false);

  const due = decideIntraday(
    { ...snap, spot: 773 },
    { date: 'x', nextDueIso: '2026-07-01T14:50:00Z', triggersPosted: [] },
    inWindow,
  );
  ok('a timed update posts once the gap has elapsed', due.post === true);

  const outside = decideIntraday(
    { ...snap, spot: 773 },
    { date: 'x', nextDueIso: null, triggersPosted: [] },
    new Date('2026-07-01T21:00:00Z'), // 4:00 CT
  );
  ok('outside the window, a non-break firing does not post', outside.post === false);

  const breakOutside = decideIntraday(
    { ...snap, spot: 768 },
    { date: 'x', nextDueIso: null, triggersPosted: [] },
    new Date('2026-07-01T21:00:00Z'),
  );
  ok('a break still fires outside the window', breakOutside.post === true && breakOutside.trigger === 'below-flip');
}

// --- Posting-day gates: holidays and early closes ----------------------------

section('isPostingDay skips weekends, holidays, and early-close half-days');
{
  const holiday = { isClosed: (d) => d === '2026-07-03', closeHour: () => 16 };
  const early = { isClosed: () => false, closeHour: (d) => (d === '2026-11-27' ? 13 : 16) };
  ok('a normal weekday is a posting day', isPostingDay('2026-07-01', holiday) === true);
  ok('a holiday is skipped', isPostingDay('2026-07-03', holiday) === false);
  ok('a Saturday is skipped', isPostingDay('2026-07-04', holiday) === false);
  ok('an early-close half-day is skipped', isPostingDay('2026-11-27', early) === false);
  ok('isEarlyClose true when the close is before 16:00', isEarlyClose('2026-11-27', early) === true);
  ok('isEarlyClose false on a full day', isEarlyClose('2026-07-01', early) === false);
  ok('a still-open full trading day posts', isTradingDay('2026-11-27', early) === true && isPostingDay('2026-11-27', early) === false);
}

// --- Phrase bank -------------------------------------------------------------

section('Every phrase (with long numbers + the longest mover) fits 280 and is clean');
{
  const V = { spot: '8888.88', sup: '8888', res: '8888', flip: '8888', strong: '$WWWWW', strong2: '$WWWWW', weak: '$WWWWW' };
  const longSnap = { spot: 8888.88, changePct: 0.1234, dayHigh: null, dayLow: null, mood: 'wild', resistance: 8888, support: 8888, flip: 8888, strong: [{ symbol: 'WWWWW', score: 99 }, { symbol: 'WWWWW', score: 88 }], weak: [{ symbol: 'WWWWW', score: 1 }], headline: null, dataIso: '2026-09-21T15:00:00Z' };
  const longestMover = MOVERS.map((m) => render(m, V)).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  let allFit = true;
  const allPools = [...Object.entries(PHRASES), ...Object.entries(AT_LEVEL)];
  for (const [sit, arr] of allPools) {
    arr.forEach((t, i) => {
      const body = render(t, V);
      if (body === null) { allFit = false; ok(`${sit}#${i} renders`, false, t); return; }
      const full = finishIntraday(`${body}\n${longestMover}`, longSnap);
      if (full.length > 280 || checkPost(full.text).length > 0) allFit = false;
    });
  }
  ok('all phrases + mover fit 280 and pass checkPost', allFit);
  ok('the disclaimer is on every finished phrase', finishIntraday(render(PHRASES.IN_RANGE[0], V), longSnap).text.endsWith(NFA));

  // The full three-part composed post fits 280 in the worst case too.
  let composedFit = true;
  for (const spot of [8888.88, 8871, 8905, 8850, 8888.88]) {
    const p = composeIntradayPhrase({ ...longSnap, spot }, { rand: () => 0, moverRand: () => 0 });
    if (!p || p.composed.length > 280 || checkPost(p.composed.text).length > 0) composedFit = false;
  }
  ok('a full 3-part post fits 280 and is clean across situations', composedFit);
}

section('Intraday post structure: three parts + disclaimer, longer body');
{
  const p = composeIntradayPhrase(snap, { rand: () => 0, moverRand: () => 0 });
  const lines = p.composed.text.split('\n');
  ok('has line 1 (phrase), line 2 (context), line 3 (mover), + disclaimer', lines.length === 4, JSON.stringify(lines));
  ok('line 2 carries the day change words', /Up|Down|Flat/.test(lines[1]), lines[1]);
  ok('line 2 carries the range', /Range to watch: \d+ to \d+\.|Ceiling at \d+\.|Floor at \d+\./.test(lines[1]), lines[1]);
  ok('line 3 is a mover line', /[A-Z]{2,}/.test(lines[2]) && /(leading|lagging|front|laggard|trailing|strongest|weakest)/.test(lines[2]), lines[2]);
  ok('ends with the disclaimer', lines[3] === NFA);
  ok('the body is meatier than a one-liner (>120 chars)', p.composed.text.length > 120, String(p.composed.text.length));
  ok('range levels render as whole numbers', /Range to watch: 772 to 775\./.test(lines[1]), lines[1]);
}

section('roundLevel and dayChangeWords');
ok('roundLevel rounds to whole', roundLevel(767.54) === '768' && roundLevel(767.4) === '767');
ok('dayChangeWords up', dayChangeWords(0.0032) === 'Up 0.3% on the day.');
ok('dayChangeWords down', dayChangeWords(-0.0021) === 'Down 0.2% on the day.');
ok('dayChangeWords flat never -0.0%', dayChangeWords(-0.0003) === 'Flat on the day.');

section('At-level: within 0.1% of a wall names the next level, not "the level to watch"');
{
  // spot right on resistance 775 (within 0.1% → |Δ| ≤ 0.775).
  const atRes = composeIntradayPhrase({ ...snap, spot: 775.2 }, { rand: () => 0, moverRand: () => 1 });
  ok('at-resistance uses the AT pool', atRes.phraseId.startsWith('NEAR_RESIST_AT#'), atRes.phraseId);
  ok('names the other-side level, not "level to watch"', !/level to watch/i.test(atRes.composed.text));
  // spot right on support 772 (within 0.1% → |Δ| ≤ 0.772), flip present as the next level.
  const atSup = composeIntradayPhrase({ ...snap, spot: 772.3 }, { rand: () => 0, moverRand: () => 1 });
  ok('at-support uses the AT pool and names the flip below', atSup.phraseId.startsWith('NEAR_SUPPORT_AT#') && /770/.test(atSup.composed.text), atSup.composed.text);
}

section('Wild wording is held back when not allowed');
{
  // Under the flip → BELOW_FLIP. With allowWild:false, only neutral phrases (0–2).
  const belowFlip = { ...snap, spot: 760 };
  let sawWild = false;
  for (let i = 0; i < 40; i += 1) {
    const p = composeIntradayPhrase(belowFlip, { allowWild: false, rand: Math.random, moverRand: () => 1 });
    if (p.wild) sawWild = true;
    const idx = Number(p.phraseId.split('#')[1]);
    if ((WILD_INDICES.BELOW_FLIP ?? []).includes(idx)) sawWild = true;
  }
  ok('no wild phrase is ever chosen when allowWild is false', sawWild === false);
  // With allowWild:true the wild phrases are reachable.
  const reachable = [...Array(60)].some(() => {
    const p = composeIntradayPhrase(belowFlip, { allowWild: true, rand: Math.random, moverRand: () => 1 });
    return p.wild === true;
  });
  ok('wild phrases are reachable when allowWild is true', reachable);
}

section('applyLockedLevels overlays the day levels, keeps price and movers live');
{
  const live = { ...snap, spot: 800, changePct: 0.02, flip: 795, support: 798, resistance: 803, strong: [{ symbol: 'AAA', score: 9 }], weak: [{ symbol: 'ZZZ', score: 1 }] };
  const locked = { flip: 770, support: 772, resistance: 775 };
  const eff = applyLockedLevels(live, locked);
  ok('levels come from the lock', eff.flip === 770 && eff.support === 772 && eff.resistance === 775);
  ok('price and movers stay live', eff.spot === 800 && eff.changePct === 0.02 && eff.strong[0].symbol === 'AAA');
  ok('null lock is a no-op', applyLockedLevels(live, null) === live);
  ok('lockableLevels reads the three levels', JSON.stringify(lockableLevels(live)) === JSON.stringify({ flip: 795, support: 798, resistance: 803 }));
}

section('pickSituation picks the first matching situation in order (0.15% cross margin)');
ok('below flip (clear of the margin)', pickSituation({ ...snap, spot: 768 }) === 'BELOW_FLIP');
ok('a hair below flip is not BELOW_FLIP', pickSituation({ ...snap, spot: 769.5 }) !== 'BELOW_FLIP');
ok('near support', pickSituation({ ...snap, spot: 772.5 }) === 'NEAR_SUPPORT');
ok('near resistance', pickSituation({ ...snap, spot: 774.6 }) === 'NEAR_RESIST');
ok('broke up (clear of the ceiling)', pickSituation({ ...snap, spot: 780 }) === 'BROKE_UP');
ok('broke down (below support, above flip)', pickSituation({ ...snap, spot: 770.5 }) === 'BROKE_DOWN');
ok('in range', pickSituation({ ...snap, spot: 773.4 }) === 'IN_RANGE');

section('composeIntradayPhrase: no reuse today, prefer least-used, fallback on nulls');
{
  const inRange = { ...snap, spot: 773.4 };
  const p = composeIntradayPhrase(inRange, { rand: () => 0 });
  ok('returns a phrase for the situation', p !== null && p.situation === 'IN_RANGE');
  ok('phraseId has the SITUATION#index shape', /^IN_RANGE#\d+$/.test(p.phraseId), p.phraseId);
  ok('the finished text carries the disclaimer', p.composed.text.endsWith(NFA));

  // All IN_RANGE ids used except #2 → the fresh #2 is the only candidate.
  const nAll = PHRASES.IN_RANGE.length;
  const usedAllBut2 = [...Array(nAll).keys()].filter((i) => i !== 2).map((i) => phraseId('IN_RANGE', i));
  const only2 = composeIntradayPhrase(inRange, { used: usedAllBut2, rand: () => 0 });
  ok('never reuses a phrase used today while one is fresh', only2.phraseId === 'IN_RANGE#2', only2.phraseId);

  // All fresh, but usage says every phrase ran a lot except #5 → least-used wins.
  const usage = {};
  for (let i = 0; i < nAll; i += 1) usage[phraseId('IN_RANGE', i)] = i === 5 ? 0 : 9;
  const least = composeIntradayPhrase(inRange, { usage, rand: () => 0 });
  ok('prefers the least-used phrase over recent days', least.phraseId === 'IN_RANGE#5', least.phraseId);

  // No levels at all → only the spot-only IN_RANGE lines render; still clean, no
  // stray "{sup}" placeholder, disclaimer intact.
  const bare = composeIntradayPhrase({ ...snap, spot: 773.4, support: null, resistance: null, flip: null });
  ok('still returns a clean spot-only phrase with no levels', bare !== null && !/\{[a-z]+\}/.test(bare.composed.text) && checkPost(bare.composed.text).length === 0, bare && bare.composed.text);
}

section('phraseUsage counts only sent intraday rows in the window');
{
  const since = Date.parse('2026-09-16T00:00:00Z');
  const rows = [
    { slot: 'intraday', outcome: 'sent', at: '2026-09-18T15:00:00Z', phraseId: 'IN_RANGE#1' },
    { slot: 'intraday', outcome: 'sent', at: '2026-09-19T15:00:00Z', phraseId: 'IN_RANGE#1' },
    { slot: 'intraday', outcome: 'skipped', at: '2026-09-19T16:00:00Z', phraseId: 'IN_RANGE#2' }, // skipped: ignored
    { slot: 'morning', outcome: 'sent', at: '2026-09-19T13:30:00Z' }, // not intraday: ignored
    { slot: 'intraday', outcome: 'sent', at: '2026-09-10T15:00:00Z', phraseId: 'IN_RANGE#1' }, // before window
  ];
  const u = phraseUsage(rows, since);
  ok('counts two in-window sends of #1', u['IN_RANGE#1'] === 2, JSON.stringify(u));
  ok('ignores skips and out-of-window', u['IN_RANGE#2'] === undefined);
}

// --- Autonomous dispatch: nextAction -----------------------------------------

section('nextAction decides the tick (and never double-posts a slot)');
const idleIntraday = { post: false, reason: 'not due' };
const dueIntraday = { post: true, trigger: null, slotKey: 'intraday-1000' };
function tick(over) {
  return nextAction({ hour: 10, minute: 0, morningPosted: false, closingPosted: false, summarySent: false, stale: false, intraday: idleIntraday, ...over });
}
ok('morning due, fresh → morning', tick({ hour: 8, minute: 30 }).kind === 'morning');
ok('morning already posted → idle (no double post)', tick({ hour: 8, minute: 35, morningPosted: true }).kind === 'idle');
ok('morning due but stale → wait (retry next tick)', tick({ hour: 8, minute: 30, stale: true }).kind === 'wait');
ok('before 8:30 → idle', tick({ hour: 8, minute: 20 }).kind === 'idle');
ok('closing due, fresh → closing', tick({ hour: 15, minute: 15 }).kind === 'closing');
ok('closing already posted → idle', tick({ hour: 15, minute: 20, closingPosted: true }).kind === 'idle');
ok('closing due but stale → wait', tick({ hour: 15, minute: 15, stale: true }).kind === 'wait');
ok('intraday due, fresh → intraday', tick({ intraday: dueIntraday }).kind === 'intraday');
ok('intraday due but stale → wait', tick({ intraday: dueIntraday, stale: true }).kind === 'wait');
ok('nothing due → idle', tick({}).kind === 'idle');
ok('4:30 CT, summary not sent → summary', tick({ hour: 16, minute: 30 }).kind === 'summary');
ok('4:30 CT, summary already sent → idle', tick({ hour: 16, minute: 30, summarySent: true }).kind === 'idle');
ok('a level break is named in the reason', tick({ intraday: { post: true, trigger: 'below-flip', slotKey: 'intraday-trigger-below-flip' } }).reason.includes('below-flip'));

// --- Self-healing: auto-resume -----------------------------------------------

section('shouldAutoResume: pause-today next day, hourly auth re-test, never open-ended');
{
  const now = new Date('2026-09-21T15:00:00Z');
  ok('a "pause today" resumes on a later trading day', shouldAutoResume({ paused: true, by: 'owner', scope: 'today', date: '2026-09-18' }, '2026-09-21', now).resume === true);
  ok('a "pause today" stays paused the same day', shouldAutoResume({ paused: true, by: 'owner', scope: 'today', date: '2026-09-21' }, '2026-09-21', now).resume === false);
  ok('an auto-pause older than an hour re-tests', shouldAutoResume({ paused: true, by: 'auto', at: '2026-09-21T13:30:00Z' }, '2026-09-21', now).resume === true);
  ok('an auto-pause under an hour waits', shouldAutoResume({ paused: true, by: 'auto', at: '2026-09-21T14:30:00Z' }, '2026-09-21', now).resume === false);
  ok('an open-ended owner pause never auto-resumes', shouldAutoResume({ paused: true, by: 'owner', scope: 'until-fixed' }, '2026-09-21', now).resume === false);
  ok('a poster that is not paused stays that way', shouldAutoResume({ paused: false }, '2026-09-21', now).resume === false);
}

section('marketHoursStaleAlarm fires only when stale, in-session, throttled hourly');
{
  const now = new Date('2026-09-24T15:00:00Z');
  ok('fresh data → no alarm', marketHoursStaleAlarm({ hour: 10, minute: 0, stale: false, now }) === false);
  ok('stale, mid-session, never alerted → alarm', marketHoursStaleAlarm({ hour: 10, minute: 0, stale: true, now }) === true);
  ok('stale but before 8:30 CT → no alarm', marketHoursStaleAlarm({ hour: 8, minute: 15, stale: true, now }) === false);
  ok('stale but after 3:00 CT → no alarm (close covers it)', marketHoursStaleAlarm({ hour: 15, minute: 30, stale: true, now }) === false);
  ok('stale, alerted 20 min ago → throttled', marketHoursStaleAlarm({ hour: 10, minute: 0, stale: true, staleAlertedAt: '2026-09-24T14:40:00Z', now }) === false);
  ok('stale, alerted 70 min ago → alarm again', marketHoursStaleAlarm({ hour: 10, minute: 0, stale: true, staleAlertedAt: '2026-09-24T13:50:00Z', now }) === true);
  ok('at the open (8:30 CT) → in session', marketHoursStaleAlarm({ hour: 8, minute: 30, stale: true, now }) === true);
}

// --- Self-reporting ----------------------------------------------------------

section('consecutiveSkips and summariseDay');
{
  const rows = [
    { slot: 'morning', slotKey: 'morning', outcome: 'sent', at: '2026-09-21T13:30:00Z' },
    { slot: 'intraday', slotKey: 'intraday-1000', outcome: 'skipped', reason: 'stale', at: '2026-09-21T15:00:00Z' },
    { slot: 'intraday', slotKey: 'intraday-1040', outcome: 'skipped', reason: 'stale', at: '2026-09-21T15:40:00Z' },
    { slot: 'intraday', slotKey: 'intraday-1120', outcome: 'skipped', reason: 'stale', at: '2026-09-21T16:20:00Z' },
  ];
  ok('three trailing skips count as 3 in a row', consecutiveSkips(rows) === 3);
  ok('a sent post resets the streak', consecutiveSkips([...rows, { slot: 'closing', slotKey: 'closing', outcome: 'sent', at: '2026-09-21T20:20:00Z' }]) === 0);

  const sum = summariseDay(rows, '2026-09-21');
  ok('summary counts sends and skips', sum.sent === 1 && sum.skipped === 3);
  ok('summary subject names the counts', /1 posted, 3 skipped/.test(sum.subject), sum.subject);
  ok('summary body lists a skip reason', sum.text.includes('stale'));
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
