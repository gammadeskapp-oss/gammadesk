import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed links for the email flow, so no pending-subscriber state has to be
 * stored anywhere. The token carries the email address and what the link is
 * for, signed with EMAIL_TOKEN_SECRET; the endpoint re-derives the signature
 * and refuses anything that does not match.
 *
 * The secret is passed in rather than read from the environment here, so this
 * stays pure and `scripts/verify-email.mjs` can exercise it with a fixed key.
 *
 * Two purposes:
 *   confirm     — double opt-in. Expires (a stale confirm link is useless).
 *   unsubscribe — must keep working forever, by law, so it never expires.
 */

export type TokenPurpose = 'confirm' | 'unsubscribe';

/** Confirm links are good for three days; plenty for an inbox, short enough. */
export const CONFIRM_TTL_MS = 3 * 24 * 60 * 60 * 1000;

interface Payload {
  /** email */
  e: string;
  /** purpose */
  p: TokenPurpose;
  /** issued-at, ms */
  t: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Mint a token binding `email` to `purpose`, stamped at `now`. */
export function signEmailToken(
  input: { email: string; purpose: TokenPurpose },
  secret: string,
  now: Date = new Date(),
): string {
  const payload: Payload = { e: input.email.trim().toLowerCase(), p: input.purpose, t: now.getTime() };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export interface VerifyResult {
  ok: boolean;
  email?: string;
  /** Why it failed, for logs — never shown raw to the user. */
  reason?: string;
}

/**
 * Verify a token for the expected purpose. Constant-time on the signature.
 * Confirm tokens are also checked against CONFIRM_TTL_MS; unsubscribe tokens
 * are not, so an old unsubscribe link still works.
 */
export function verifyEmailToken(
  token: string | null | undefined,
  purpose: TokenPurpose,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };

  const payloadB64 = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payloadB64, secret);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Payload;
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (payload.p !== purpose) return { ok: false, reason: 'wrong-purpose' };
  if (typeof payload.e !== 'string' || !payload.e) return { ok: false, reason: 'no-email' };

  if (purpose === 'confirm') {
    if (!Number.isFinite(payload.t)) return { ok: false, reason: 'no-timestamp' };
    const age = now.getTime() - payload.t;
    if (age < 0 || age > CONFIRM_TTL_MS) return { ok: false, reason: 'expired' };
  }

  return { ok: true, email: payload.e };
}
