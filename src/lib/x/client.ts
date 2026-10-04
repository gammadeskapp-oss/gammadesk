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
// Media upload uses the v2 chunked (INIT/APPEND/FINALIZE) flow on api.x.com.
// The legacy v1.1 upload host (upload.twitter.com/1.1/media/upload.json) was
// retired on 2025-03-31. The v2 single-POST simple upload is not a working
// substitute either — it returns HTTP 400 — so v2 exposes the upload only
// through three RESTful sub-endpoints, each signed with the same OAuth 1.0a
// user-context header. Verified live 2026-10-04: initialize/append/finalize all
// 200, returning a media id that attaches to a v2 tweet.
const MEDIA_INITIALIZE_URL = 'https://api.x.com/2/media/upload/initialize';
const mediaAppendUrl = (id: string) => `https://api.x.com/2/media/upload/${id}/append`;
const mediaFinalizeUrl = (id: string) => `https://api.x.com/2/media/upload/${id}/finalize`;

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

/** One failed-step result, with the step named so a log shows where it broke. */
function uploadFailed(step: string, status: number, raw: string): MediaUploadResult {
  const detail = raw.slice(0, 200).replace(/\s+/g, ' ').trim();
  return { ok: false, error: `X media ${step} HTTP ${status}${detail ? `: ${detail}` : ''}.` };
}

/**
 * Upload one image to X via the v2 chunked flow, signed with OAuth 1.0a.
 *
 * Three steps, each its own request with its own OAuth header (none of the
 * bodies — JSON or multipart — is part of the signature base string, so the
 * header is signed with the oauth params alone, same as the JSON tweet POST):
 *   1. POST /2/media/upload/initialize  (JSON: media_type, total_bytes,
 *      media_category) → returns the media id.
 *   2. POST /2/media/upload/{id}/append (multipart: media, segment_index). The
 *      poster image is a single small PNG, so one segment is always enough.
 *   3. POST /2/media/upload/{id}/finalize → the id is now attachable to a tweet.
 *
 * Returns that media id. Never throws; any failure comes back as
 * `{ ok: false }` with the failing step named, so the caller can fall back to a
 * text-only post.
 */
export async function uploadMedia(bytes: Uint8Array, mime = 'image/png'): Promise<MediaUploadResult> {
  const creds = readCredentials();
  if (!creds) return { ok: false, error: 'X credentials are not configured.' };

  // --- 1. initialize ---
  let mediaId: string;
  try {
    const res = await fetch(MEDIA_INITIALIZE_URL, {
      method: 'POST',
      headers: { Authorization: buildAuthHeader('POST', MEDIA_INITIALIZE_URL, creds), 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: mime, total_bytes: bytes.byteLength, media_category: 'tweet_image' }),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await res.text().catch(() => '');
    if (!res.ok) return uploadFailed('initialize', res.status, raw);
    const j = JSON.parse(raw) as { data?: { id?: string } };
    const id = j.data?.id;
    if (!id) return { ok: false, error: 'X media initialize returned no media id.' };
    mediaId = String(id);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'X media initialize failed.' };
  }

  // --- 2. append (single segment) ---
  try {
    const appendUrl = mediaAppendUrl(mediaId);
    const form = new FormData();
    // Copy into a fresh ArrayBuffer so the Blob part is a plain ArrayBuffer (not
    // a possibly-shared/offset view), which the DOM typings require.
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.append('media', new Blob([ab], { type: mime }), 'poster.png');
    form.append('segment_index', '0');
    const res = await fetch(appendUrl, {
      method: 'POST',
      // Content-Type (with boundary) is set by fetch from the FormData body.
      headers: { Authorization: buildAuthHeader('POST', appendUrl, creds) },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return uploadFailed('append', res.status, await res.text().catch(() => ''));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'X media append failed.' };
  }

  // --- 3. finalize ---
  try {
    const finalizeUrl = mediaFinalizeUrl(mediaId);
    const res = await fetch(finalizeUrl, {
      method: 'POST',
      headers: { Authorization: buildAuthHeader('POST', finalizeUrl, creds) },
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await res.text().catch(() => '');
    if (!res.ok) return uploadFailed('finalize', res.status, raw);
    // finalize echoes the id; fall back to the initialize id if the body is thin.
    try {
      const j = JSON.parse(raw) as { data?: { id?: string } };
      return { ok: true, mediaId: String(j.data?.id ?? mediaId) };
    } catch {
      return { ok: true, mediaId };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'X media finalize failed.' };
  }
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
