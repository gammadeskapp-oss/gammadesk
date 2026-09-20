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
// Media upload uses the v1.1 endpoint: it is the stable, universally-used media
// upload for OAuth 1.0a user context, and the v2 simple-upload endpoint rejects
// this multipart request outright (verified live: HTTP 400). The returned
// media id is then attached to a v2 tweet — the standard cross-version pattern.
const MEDIA_URL = 'https://upload.twitter.com/1.1/media/upload.json';

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

export interface MediaUploadResult {
  ok: boolean;
  mediaId?: string;
  error?: string;
}

/**
 * Upload one image to X (v1.1 media upload, simple non-chunked), signed with
 * OAuth 1.0a. The multipart body is not part of the signature base string (only
 * query/form-urlencoded params are), so the header is signed with the oauth
 * params alone — the same as the JSON tweet POST.
 *
 * Returns the media id (`media_id_string`) to attach to a v2 tweet. Never
 * throws; any failure comes back as `{ ok: false }` so the caller can fall back
 * to a text-only post.
 */
export async function uploadMedia(bytes: Uint8Array, mime = 'image/png'): Promise<MediaUploadResult> {
  const creds = readCredentials();
  if (!creds) return { ok: false, error: 'X credentials are not configured.' };

  const authHeader = buildAuthHeader('POST', MEDIA_URL, creds);
  const form = new FormData();
  // Copy into a fresh ArrayBuffer so the Blob part is a plain ArrayBuffer (not
  // a possibly-shared/offset view), which the DOM typings require.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append('media', new Blob([ab], { type: mime }), 'poster.png');
  form.append('media_category', 'tweet_image');

  let response: Response;
  try {
    response = await fetch(MEDIA_URL, {
      method: 'POST',
      // Content-Type (with boundary) is set by fetch from the FormData body.
      headers: { Authorization: authHeader },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Media upload failed.' };
  }

  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    const detail = raw.slice(0, 200).replace(/\s+/g, ' ').trim();
    return { ok: false, error: `X media upload HTTP ${response.status}${detail ? `: ${detail}` : ''}.` };
  }
  try {
    const j = JSON.parse(raw) as { data?: { id?: string }; media_id_string?: string; id?: string };
    const id = j.data?.id ?? j.media_id_string ?? j.id;
    if (id) return { ok: true, mediaId: String(id) };
  } catch {
    // fall through
  }
  return { ok: false, error: 'X media upload returned no media id.' };
}

/**
 * Send one tweet, optionally with an attached image. A single attempt — the
 * retry lives in `run.ts` so the log can record each try. Never throws; a
 * network failure comes back as `{ ok: false, kind: 'other' }`.
 */
export async function postTweet(text: string, mediaId?: string): Promise<PostResult> {
  const creds = readCredentials();
  if (!creds) {
    return { ok: false, kind: 'auth', error: 'X credentials are not configured.' };
  }

  const authHeader = buildAuthHeader('POST', TWEET_URL, creds);
  const body = mediaId ? { text, media: { media_ids: [mediaId] } } : { text };

  let response: Response;
  try {
    response = await fetch(TWEET_URL, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
