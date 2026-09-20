import 'server-only';

import { buildAuthHeader, classify, type XCredentials } from './oauth';
import type { PostResult } from './types';

/**
 * Post a tweet to X using OAuth 1.0a user-context signing.
 *
 * The four credentials are read from the environment at request time and used
 * only to build the `Authorization` header (in `oauth.ts`). They are never
 * logged, never returned, and never placed in the body or the URL.
 *
 * OAuth 1.0a is used because posting on behalf of an account (`POST /2/tweets`)
 * needs user-context auth, and the app is configured for read+write OAuth 1.0a.
 */

const TWEET_URL = 'https://api.twitter.com/2/tweets';

/** Read at request time via bracket access so a bundler cannot inline it. */
function env(name: string): string | undefined {
  const value = process.env[name];
  const trimmed = typeof value === 'string' ? value.trim() : undefined;
  return trimmed ? trimmed : undefined;
}

/**
 * The four X credentials, or null when any is missing. Returning null (rather
 * than throwing) lets the caller log a clean "not configured" line and never
 * attempt an unsigned request.
 */
export function readCredentials(): XCredentials | null {
  const apiKey = env('X_API_KEY');
  const apiSecret = env('X_API_SECRET');
  const accessToken = env('X_ACCESS_TOKEN');
  const accessSecret = env('X_ACCESS_SECRET');
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

/**
 * Send one tweet. A single attempt — the retry lives in `run.ts` so the log can
 * record each try. Never throws; a network failure comes back as
 * `{ ok: false, kind: 'other' }`.
 */
export async function postTweet(text: string): Promise<PostResult> {
  const creds = readCredentials();
  if (!creds) {
    return { ok: false, kind: 'auth', error: 'X credentials are not configured.' };
  }

  const authHeader = buildAuthHeader('POST', TWEET_URL, creds);

  let response: Response;
  try {
    response = await fetch(TWEET_URL, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'other',
      error: error instanceof Error ? error.message : 'X request failed.',
    };
  }

  const raw = await response.text().catch(() => '');

  if (response.ok) {
    let id: string | undefined;
    try {
      id = (JSON.parse(raw) as { data?: { id?: string } }).data?.id;
    } catch {
      // A 2xx with an unparseable body still means it was accepted.
    }
    return { ok: true, tweetId: id, status: response.status };
  }

  const detail = raw.slice(0, 300).replace(/\s+/g, ' ').trim();
  return {
    ok: false,
    status: response.status,
    kind: classify(response.status, raw),
    error: `X returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
  };
}
