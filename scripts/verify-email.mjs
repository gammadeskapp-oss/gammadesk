/*
 * The pure logic behind the email brief: the signed confirm/unsubscribe tokens,
 * email validation, the brief summary, and the two email bodies. The routes and
 * the Resend calls are I/O and can't run here, so these are the parts a wrong
 * change would break silently — including the legally-required footer elements
 * (a working unsubscribe link and a mailing address in every email).
 *
 * Run: npm run verify:email
 */

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { signEmailToken, verifyEmailToken, CONFIRM_TTL_MS } = await import('../src/lib/email/token.ts');
const { normaliseEmail, briefSummaryLines, buildConfirmEmail, buildBriefEmail, escapeHtml } = await import(
  '../src/lib/email/messages.ts'
);

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

const SECRET = 'test-secret-key';
const now = new Date('2026-09-21T12:00:00Z');

section('signEmailToken / verifyEmailToken round-trip and bind purpose + email');
{
  const t = signEmailToken({ email: 'A@Example.com ', purpose: 'confirm' }, SECRET, now);
  const v = verifyEmailToken(t, 'confirm', SECRET, now);
  ok('confirm verifies', v.ok === true, JSON.stringify(v));
  ok('email is normalised in the token', v.email === 'a@example.com', v.email);
  ok('wrong purpose is rejected', verifyEmailToken(t, 'unsubscribe', SECRET, now).ok === false);
}

section('tokens are tamper-evident');
{
  const t = signEmailToken({ email: 'x@y.com', purpose: 'unsubscribe' }, SECRET, now);
  ok('wrong secret fails', verifyEmailToken(t, 'unsubscribe', 'other-secret', now).ok === false);
  ok('flipped char fails', verifyEmailToken(t.slice(0, -1) + (t.at(-1) === 'a' ? 'b' : 'a'), 'unsubscribe', SECRET, now).ok === false);
  ok('empty token fails', verifyEmailToken('', 'confirm', SECRET, now).ok === false);
  ok('garbage token fails', verifyEmailToken('nope', 'confirm', SECRET, now).ok === false);
}

section('confirm tokens expire; unsubscribe tokens never do');
{
  const t = signEmailToken({ email: 'x@y.com', purpose: 'confirm' }, SECRET, now);
  const later = new Date(now.getTime() + CONFIRM_TTL_MS + 1000);
  ok('confirm expired after TTL', verifyEmailToken(t, 'confirm', SECRET, later).ok === false);
  const u = signEmailToken({ email: 'x@y.com', purpose: 'unsubscribe' }, SECRET, now);
  const wayLater = new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000);
  ok('unsubscribe still valid years later', verifyEmailToken(u, 'unsubscribe', SECRET, wayLater).ok === true);
}

section('normaliseEmail lower-cases, trims, and rejects junk');
ok('trims + lowercases', normaliseEmail('  Foo@Bar.COM ') === 'foo@bar.com');
ok('no @ rejected', normaliseEmail('foo.com') === null);
ok('no domain dot rejected', normaliseEmail('foo@bar') === null);
ok('empty rejected', normaliseEmail('') === null);
ok('null rejected', normaliseEmail(null) === null);
ok('overlong rejected', normaliseEmail('a'.repeat(250) + '@b.com') === null);

section('briefSummaryLines is plain-English and never invents a number');
{
  const brief = { date: '2026-09-21', spy: 0.4, qqq: 0.6, iwm: -0.1, vix: 15.2, topStory: 'Futures firm', earningsToday: ['AAPL', 'MSFT'] };
  const lines = briefSummaryLines(brief);
  ok('index line signs each move', lines[0].includes('+0.4%') && lines[0].includes('+0.6%') && lines[0].includes('-0.1%'), lines[0]);
  ok('calm vix reads calm', lines[1].includes('calm'), lines[1]);
  ok('top story included', lines.includes('Futures firm'));
  ok('earnings line included', lines.some((l) => l.includes('AAPL') && l.includes('MSFT')));
}
{
  const choppy = briefSummaryLines({ date: 'x', spy: NaN, qqq: 0, iwm: 0, vix: 30, topStory: '', earningsToday: [] });
  ok('non-finite move becomes a dash', choppy[0].includes('—'), choppy[0]);
  ok('high vix reads choppy', choppy[1].includes('choppy'), choppy[1]);
  ok('blank story omitted', !choppy.includes(''));
}

section('escapeHtml neutralises angle brackets and quotes');
ok('escapes tags', escapeHtml('<b>"x"</b>') === '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');

section('every email carries an unsubscribe link and the mailing address (CAN-SPAM)');
{
  const confirm = buildConfirmEmail({
    confirmUrl: 'https://gammadesk.app/api/email/confirm?token=abc',
    unsubscribeUrl: 'https://gammadesk.app/api/email/unsubscribe?token=xyz',
    mailingAddress: '123 Test St, City, ST 00000, USA',
  });
  ok('confirm subject set', confirm.subject.toLowerCase().includes('confirm'));
  ok('confirm html has the confirm link', confirm.html.includes('token=abc'));
  ok('confirm html has an unsubscribe link', confirm.html.includes('token=xyz'));
  ok('confirm html has the mailing address', confirm.html.includes('123 Test St'));
  ok('confirm text has both too', confirm.text.includes('token=xyz') && confirm.text.includes('123 Test St'));
}
{
  const brief = buildBriefEmail({
    date: '2026-09-21',
    summaryLines: ['SPY +0.4%', 'VIX 15.2 — markets look calm'],
    posterUrl: 'https://gammadesk.app/api/email/poster/2026-09-21',
    dailyUrl: 'https://gammadesk.app/daily',
    unsubscribeHtml: '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>.',
    mailingAddress: '123 Test St, City, ST 00000, USA',
  });
  ok('brief subject names the date', brief.subject.includes('2026-09-21'));
  ok('brief html shows the poster', brief.html.includes('/api/email/poster/2026-09-21'));
  ok('brief html links to /daily', brief.html.includes('https://gammadesk.app/daily'));
  ok('brief html has the Resend unsubscribe variable', brief.html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));
  ok('brief html has the mailing address', brief.html.includes('123 Test St'));
  ok('brief html renders every summary line', brief.html.includes('SPY +0.4%') && brief.html.includes('markets look calm'));
}
{
  // With no poster the email still builds — text-only, no broken image tag.
  const noPoster = buildBriefEmail({
    date: '2026-09-21', summaryLines: ['SPY +0.4%'], posterUrl: null,
    dailyUrl: 'https://gammadesk.app/daily', unsubscribeHtml: 'x', mailingAddress: 'addr',
  });
  ok('no poster -> no <img', !noPoster.html.includes('<img'), 'should omit image');
}

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
