import { createHmac, randomBytes } from 'node:crypto';
import type { PostResult } from './types';

/**
 * OAuth 1.0a request signing for the X API — the pure, testable half of the
 * client. No `server-only` and no network, so the signature can be checked
 * against the RFC 5849 / Twitter worked example in the verify script.
 */

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986 percent-encoding — stricter than encodeURIComponent. */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Build the OAuth 1.0a `Authorization` header.
 *
 * `extraParams` is empty for the JSON tweet POST — a JSON body is neither a
 * query nor a form parameter, so it is correctly excluded from the signature
 * base string per RFC 5849 §3.4.1. It is a parameter so the signing can be
 * verified against the known Twitter example, which does carry form params.
 *
 * `nonce`/`timestamp` are injectable for the same reason: the worked example
 * fixes both.
 */
export function buildAuthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  extraParams: Record<string, string> = {},
  nonce: string = randomBytes(16).toString('hex'),
  timestamp: string = Math.floor(Date.now() / 1000).toString(),
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...oauthParams, ...extraParams };
  const paramString = Object.keys(allParams)
    .map((k) => [rfc3986(k), rfc3986(allParams[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const baseString = [method.toUpperCase(), rfc3986(url), rfc3986(paramString)].join('&');
  const signingKey = `${rfc3986(creds.apiSecret)}&${rfc3986(creds.accessSecret)}`;
  const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

  const header: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  return `OAuth ${Object.keys(header)
    .sort()
    .map((k) => `${rfc3986(k)}="${rfc3986(header[k])}"`)
    .join(', ')}`;
}

/**
 * Classify a failed X response so the caller knows how to react.
 *
 * Only two kinds ever pause the poster, because only two are "truly broken" and
 * unfixable by retrying: `auth` (a 401, or a body that says the credentials are
 * invalid/expired) and `billing` (a 402, or an out-of-credit / quota message).
 * Everything else — a plain 403 "not permitted", a rate limit, a duplicate, a
 * timeout — is `other`/`rate`/`duplicate`: the caller skips that one post and
 * carries on, and never pauses. A 403 is deliberately NOT auth: X returns it for
 * things like an image the account's API tier may not attach, which must not
 * take the whole poster down.
 */
export function classify(status: number, body: string): PostResult['kind'] {
  const b = body || '';
  // Genuinely bad credentials — the only non-billing reason to pause.
  if (/invalid or expired token|could not authenticate|unable to authenticate|bad authentication|invalid credentials|unauthoriz/i.test(b)) {
    return 'auth';
  }
  if (status === 401) return 'auth';
  // Out of credits / over quota — the billing reason to pause.
  if (status === 402 || /\b(usage|quota|cap|payment|billing|out of credit|credit balance|exceeded your)\b/i.test(b)) {
    return 'billing';
  }
  if (/duplicate/i.test(b)) return 'duplicate';
  if (status === 429) return 'rate';
  // A 403 "not permitted", a 5xx, a timeout, anything else — skip, never pause.
  return 'other';
}
