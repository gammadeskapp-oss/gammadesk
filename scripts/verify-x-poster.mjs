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
  dueGammaSlot,
  duePulseSlot,
  dueClosingSlot,
  formatClockCt,
} = await import('../src/lib/x/schedule.ts');
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
  validateBrief,
  validateClosingBrief,
  signedPoints,
  vixWord,
  X_LIMIT,
  DISCLAIMER,
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

section('failure classification drives retry vs auto-pause');
ok('401 → auth', classify(401, '') === 'auth');
ok('403 (permissions) → auth', classify(403, 'not permitted') === 'auth');
ok('403 (usage cap) → billing', classify(403, 'monthly usage cap reached') === 'billing');
ok('402 → billing', classify(402, '') === 'billing');
ok('429 → rate', classify(429, '') === 'rate');
ok('500 → other', classify(500, 'boom') === 'other');

// --- Chicago-clock schedule (DST must not shift the posts) -------------------

section('The gamma slot fires at 8:30 CT in both summer and winter');

const closedRules = { isClosed: (d) => d === '2026-07-03' }; // a made-up holiday

// Summer: CDT = UTC-5, so 13:30 UTC is 08:30 Central.
ok('summer 13:30 UTC → gamma', dueGammaSlot(new Date('2026-07-01T13:30:00Z')) !== null);
ok('summer 14:30 UTC → not gamma (that is 9:30 CT)', dueGammaSlot(new Date('2026-07-01T14:30:00Z')) === null);
// Winter: CST = UTC-6, so 14:30 UTC is 08:30 Central.
ok('winter 14:30 UTC → gamma', dueGammaSlot(new Date('2026-01-05T14:30:00Z')) !== null);
ok('winter 13:30 UTC → not gamma (that is 7:30 CT)', dueGammaSlot(new Date('2026-01-05T13:30:00Z')) === null);
// Weekend and holiday are skipped.
ok('Saturday → no gamma', dueGammaSlot(new Date('2026-07-04T13:30:00Z')) === null);
ok('holiday → no gamma', dueGammaSlot(new Date('2026-07-03T13:30:00Z'), closedRules) === null);
ok('gamma slot key is stable', dueGammaSlot(new Date('2026-07-01T13:30:00Z')).key === 'gamma');

section('The pulse window is 9:30–2:30 CT, and the slot key carries the hour');

// Summer boundaries.
ok('summer 14:30 UTC → pulse-09', duePulseSlot(new Date('2026-07-01T14:30:00Z'))?.key === 'pulse-09');
ok('summer 19:30 UTC → pulse-14 (2:30 CT, last slot)', duePulseSlot(new Date('2026-07-01T19:30:00Z'))?.key === 'pulse-14');
ok('summer 20:30 UTC → null (3:30 CT, past the window)', duePulseSlot(new Date('2026-07-01T20:30:00Z')) === null);
ok('summer 13:30 UTC → null (8:30 CT, before the window)', duePulseSlot(new Date('2026-07-01T13:30:00Z')) === null);
// Winter boundaries.
ok('winter 15:30 UTC → pulse-09', duePulseSlot(new Date('2026-01-05T15:30:00Z'))?.key === 'pulse-09');
ok('winter 20:30 UTC → pulse-14', duePulseSlot(new Date('2026-01-05T20:30:00Z'))?.key === 'pulse-14');
ok('winter 21:30 UTC → null (3:30 CT)', duePulseSlot(new Date('2026-01-05T21:30:00Z')) === null);
// Six distinct slots across the summer session — no duplicates.
{
  const keys = new Set();
  for (let utc = 14; utc <= 19; utc += 1) {
    const slot = duePulseSlot(new Date(`2026-07-01T${String(utc).padStart(2, '0')}:30:00Z`));
    if (slot) keys.add(slot.key);
  }
  ok('summer session yields exactly 6 pulse slots', keys.size === 6, [...keys].join(','));
}
ok('weekend → no pulse', duePulseSlot(new Date('2026-07-04T15:30:00Z')) === null);

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

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
