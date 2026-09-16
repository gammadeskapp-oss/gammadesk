/*
 * Validation of the TOS Trend tab's lock — the password check, the signed
 * session cookie, and the unlock rate limiter, in src/lib/tos/auth.ts and
 * src/lib/tos/rateLimit.ts.
 *
 * Why this file exists: this tab is owner-only, and the whole guarantee rests
 * on three pure functions the API routes wrap thinly. The route behaviours the
 * brief asks to prove map straight onto them:
 *
 *   - "no cookie → 401"        ⇢ verifySession(undefined) is false
 *   - "wrong password → 401"   ⇢ checkPassword('nope') is false
 *   - "valid cookie → data"    ⇢ verifySession(createSession()) is true
 *   - "lock clears access"     ⇢ the cleared cookie value '' verifies false
 *   - "rate limit kicks in"    ⇢ the 6th attempt in a window is refused
 *
 * A tampered or expired cookie, and a cookie signed under a different secret,
 * must all fail — those are the ways a client could try to forge access.
 *
 * Run: npm run verify:tos-lock
 */

// Set before importing: the auth module reads these from the environment at
// call time, so they must exist when the functions run.
process.env.TOS_TAB_PASSWORD = 'correct horse battery staple';
process.env.TOS_COOKIE_SECRET = 'a'.repeat(48);

import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const { checkPassword, safeEqual, createSession, verifySession, SESSION_MAX_AGE_S } =
  await import('../src/lib/tos/auth.ts');
const { isRateLimited, recordFailure, clearFailures, resetRateLimit } =
  await import('../src/lib/tos/rateLimit.ts');

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

// --- constant-time compare ---------------------------------------------------

section('safeEqual matches only identical strings');

ok('equal strings match', safeEqual('hunter2', 'hunter2'));
ok('different strings do not', safeEqual('hunter2', 'hunter3') === false);
ok('different lengths do not', safeEqual('short', 'longer value') === false);
ok('empty vs empty matches', safeEqual('', ''));

// --- password check ----------------------------------------------------------

section('checkPassword is server-side and exact');

ok('the right password passes', checkPassword('correct horse battery staple'));
ok('a wrong password fails', checkPassword('nope') === false);
ok('an empty password fails', checkPassword('') === false);
ok('a near miss fails', checkPassword('correct horse battery staplE') === false);

section('The configured password is trimmed of stray whitespace and wrapping quotes');

// A value copied into an env var often gains a trailing newline/space or quotes.
// The expected value is cleaned so the real password still matches.
process.env.TOS_TAB_PASSWORD = '  hunter2\n';
ok('surrounding whitespace is trimmed', checkPassword('hunter2'));
process.env.TOS_TAB_PASSWORD = '"hunter2"';
ok('double-quotes are stripped', checkPassword('hunter2'));
process.env.TOS_TAB_PASSWORD = "'hunter2'";
ok('single-quotes are stripped', checkPassword('hunter2'));
process.env.TOS_TAB_PASSWORD = '   ';
ok('an all-whitespace value is treated as unset', checkPassword('') === false && checkPassword('   ') === false);
// Restore for later sections.
process.env.TOS_TAB_PASSWORD = 'correct horse battery staple';

// --- session cookie: mint and verify ----------------------------------------

section('A freshly minted session verifies; forgeries do not');

const token = createSession();
ok('createSession returns a token', typeof token === 'string' && token.includes('.'), token);
ok('no cookie → not verified (this is the 401 path)', verifySession(undefined) === false);
ok('empty cookie → not verified (this is the lock path)', verifySession('') === false);
ok('a valid cookie → verified (this is the data path)', verifySession(token) === true);

// Tampering with either half must break the signature check.
{
  const [issued, sig] = token.split('.');
  ok('tampered payload fails', verifySession(`${Number(issued) + 1}.${sig}`) === false);
  ok('tampered signature fails', verifySession(`${issued}.${sig}xyz`) === false);
  ok('garbage fails', verifySession('not-a-real-token') === false);
}

// A cookie signed under a different secret must not verify against ours.
{
  process.env.TOS_COOKIE_SECRET = 'b'.repeat(48);
  const otherSecretToken = createSession();
  process.env.TOS_COOKIE_SECRET = 'a'.repeat(48);
  ok('a cookie from another secret fails', verifySession(otherSecretToken) === false);
}

// Age is enforced: a token issued just over 30 days ago is rejected.
{
  const now = new Date();
  const old = new Date(now.getTime() - (SESSION_MAX_AGE_S * 1000 + 60_000));
  const oldToken = createSession(old);
  ok('a 30-day-old cookie is expired', verifySession(oldToken, now) === false);
  ok('a same-instant cookie is valid', verifySession(createSession(now), now) === true);
}

// --- rate limiter ------------------------------------------------------------

section('The limiter counts only failures, and a correct password never blocks');

resetRateLimit();
{
  const key = 'ip:test';
  const start = 1_000_000;
  const window = 15 * 60 * 1000;

  // Peeking does not itself count: check it many times, still allowed.
  for (let i = 0; i < 10; i += 1) {
    ok(`peek ${i} does not count`, isRateLimited(key, 5, start).blocked === false);
  }

  // Five wrong guesses are allowed; the sixth is blocked.
  for (let i = 1; i <= 5; i += 1) {
    ok(`before failure ${i}, still allowed`, isRateLimited(key, 5, start).blocked === false);
    recordFailure(key, window, start);
  }
  const sixth = isRateLimited(key, 5, start);
  ok('after 5 failures, the 6th is blocked', sixth.blocked === true);
  ok('the block carries a retry-after', sixth.retryAfterS > 0, String(sixth.retryAfterS));

  // A correct password clears the failures — the owner is not locked out.
  clearFailures(key);
  ok('a correct password (clearFailures) unblocks immediately', isRateLimited(key, 5, start).blocked === false);

  // A different IP has its own budget.
  ok('another IP is unaffected', isRateLimited('ip:other', 5, start).blocked === false);

  // Once the window elapses, an over-limit IP is allowed again.
  for (let i = 0; i < 6; i += 1) recordFailure(key, window, start);
  ok('blocked within the window', isRateLimited(key, 5, start).blocked === true);
  ok('window reset re-allows', isRateLimited(key, 5, start + window + 1).blocked === false);
}

// --- result ------------------------------------------------------------------

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} checks FAILED\n`);
  process.exit(1);
}
console.log(`${checks} checks passed\n`);
