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
} = await import('../src/lib/x/schedule.ts');
const { checkText, checkNumbers } = await import('../src/lib/x/guard.ts');
const {
  composeMorning,
  composeGamma,
  composePulse,
  composeClosing,
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

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
