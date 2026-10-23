import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * The password lock on every `/lab` route and every `/api/lab` endpoint.
 *
 * ## What is stored
 *
 * `LAB_PASSWORD_HASH` only — never the password. Its format is
 * `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`, produced by
 * `node scripts/lab-hash.mjs <password>`. The password is checked on the server
 * by re-deriving with the stored salt and cost and comparing in constant time.
 *
 * ## The session
 *
 * A pass mints `<expiry ms>.<HMAC>`. The HMAC key is `LAB_SESSION_SECRET` when
 * set, otherwise derived from the stored hash — so rotating the password also
 * invalidates every outstanding session, which is the behaviour a single-owner
 * lock wants. The cookie carries no Max-Age (a browser-session cookie, no
 * "remember me") and the server enforces its own expiry on top, because a
 * browser restoring a session on restart would otherwise keep it alive forever.
 *
 * Pure functions over env + inputs, no framework imports, so `proxy.ts`, the
 * pages and the routes all run the same check and it can be tested directly.
 */

export const LAB_SESSION_COOKIE = 'lab_session';

/** Hard server-side lifetime of one session. */
export const LAB_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Read at request time; bracket access defeats build-time inlining. */
function readEnv(name: string): string | undefined {
  const key = name;
  const raw = process.env[key]?.trim();
  if (!raw) return undefined;
  // A value pasted into a dashboard often keeps its wrapping quotes.
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (raw.length >= 2 && first === last && (first === '"' || first === "'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string | undefined): ParsedHash | null {
  if (!stored) return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');
  if (salt.length < 8 || hash.length < 16) return null;
  return { N, r, p, salt, hash };
}

/** Whether the lock has a usable hash. Without one nothing can log in. */
export function labPasswordConfigured(): boolean {
  return parseHash(readEnv('LAB_PASSWORD_HASH')) !== null;
}

/** Hash a password in the stored format. Used by the CLI script and tests. */
export function hashLabPassword(password: string, salt: Buffer, N = 16384, r = 8, p = 1): string {
  const hash = scryptSync(password, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/**
 * Whether `submitted` matches `LAB_PASSWORD_HASH`. False, never throwing, when
 * the hash is unset or malformed — a misconfigured deploy stays locked.
 */
export function checkLabPassword(submitted: unknown): boolean {
  const parsed = parseHash(readEnv('LAB_PASSWORD_HASH'));
  if (!parsed) return false;
  if (typeof submitted !== 'string' || submitted.length === 0 || submitted.length > 512) {
    return false;
  }
  let derived: Buffer;
  try {
    derived = scryptSync(submitted, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

function sessionKey(): string | null {
  const explicit = readEnv('LAB_SESSION_SECRET');
  if (explicit) return explicit;
  const stored = readEnv('LAB_PASSWORD_HASH');
  if (!parseHash(stored)) return null;
  return createHmac('sha256', 'gammadesk-lab-session').update(stored!).digest('base64url');
}

function sign(payload: string, key: string): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

/** Mint a session token, or null when the lock is not configured. */
export function createLabSession(now: number = Date.now()): string | null {
  const key = sessionKey();
  if (!key) return null;
  const expires = String(now + LAB_SESSION_TTL_MS);
  return `${expires}.${sign(expires, key).toString('base64url')}`;
}

/** Signature intact and not expired. Null-safe; constant-time on the MAC. */
export function verifyLabSession(token: string | undefined | null, now: number = Date.now()): boolean {
  const key = sessionKey();
  if (!key || !token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expires = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = sign(expires, key);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
  const expiresMs = Number(expires);
  if (!Number.isFinite(expiresMs)) return false;
  // Also refuse a token minted with an expiry beyond one TTL from now.
  return expiresMs > now && expiresMs - now <= LAB_SESSION_TTL_MS;
}
