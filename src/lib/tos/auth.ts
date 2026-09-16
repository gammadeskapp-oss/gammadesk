import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The owner-only lock on the TOS Trend tab.
 *
 * The password is checked on the server only, in constant time, against
 * TOS_TAB_PASSWORD. A pass mints a signed session token — an issue timestamp
 * with an HMAC over it, keyed by TOS_COOKIE_SECRET — which the browser holds in
 * an httpOnly cookie and hands back on every request. The server re-verifies
 * the signature and the age on each read, so a tampered or expired cookie is
 * rejected and nothing on the client can forge access.
 *
 * Pure functions over env + inputs, no framework imports, so the security logic
 * can be unit-tested directly.
 */

export const SESSION_COOKIE = 'tos_session';

/** 30 days, in seconds and milliseconds. */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_S * 1000;

function cookieSecret(): string | null {
  const secret = process.env.TOS_COOKIE_SECRET?.trim();
  return secret ? secret : null;
}

/** Strip one pair of matching wrapping quotes, e.g. a `.env` value quoted by hand. */
function stripWrappingQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * The configured password, or null when unset.
 *
 * Trimmed of surrounding whitespace and a single pair of wrapping quotes,
 * because a value copied into `.env.local` or a Vercel env var commonly picks
 * up a trailing newline/space or quotes that were never meant to be part of the
 * secret — and "the password is right but doesn't work" is exactly that.
 */
function tabPassword(): string | null {
  const raw = process.env.TOS_TAB_PASSWORD;
  if (raw == null) return null;
  const cleaned = stripWrappingQuotes(raw.trim());
  return cleaned ? cleaned : null;
}

/** Constant-time string compare that does not leak length through early return. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual requires equal lengths; hash both to a fixed width first so
  // a length difference is compared in constant time rather than short-circuited.
  const ah = createHmac('sha256', 'len').update(ab).digest();
  const bh = createHmac('sha256', 'len').update(bb).digest();
  return timingSafeEqual(ah, bh) && ab.length === bb.length;
}

/**
 * Whether the submitted password is correct. False (never throwing) when
 * TOS_TAB_PASSWORD is unset, so a misconfigured deploy stays locked rather than
 * open.
 */
export function checkPassword(submitted: string): boolean {
  const expected = tabPassword();
  if (!expected) return false;
  return safeEqual(submitted, expected);
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Mint a session token for `now`. Returns null if TOS_COOKIE_SECRET is unset —
 * the caller then refuses to unlock rather than issuing an unsigned cookie.
 */
export function createSession(now: Date = new Date()): string | null {
  const secret = cookieSecret();
  if (!secret) return null;
  const issued = String(now.getTime());
  return `${issued}.${sign(issued, secret)}`;
}

/**
 * Verify a cookie value: signature intact and issued within the last 30 days.
 * Constant-time on the signature, and null-safe on a missing/blank token.
 */
export function verifySession(token: string | undefined | null, now: Date = new Date()): boolean {
  const secret = cookieSecret();
  if (!secret || !token) return false;

  const dot = token.indexOf('.');
  if (dot <= 0) return false;

  const issued = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(issued, secret);
  if (!safeEqual(provided, expected)) return false;

  const issuedMs = Number(issued);
  if (!Number.isFinite(issuedMs)) return false;
  const age = now.getTime() - issuedMs;
  return age >= 0 && age <= SESSION_MAX_AGE_MS;
}
