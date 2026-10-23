import 'server-only';

/**
 * Tastytrade credentials → access token → streamer token. Server-only.
 *
 * ## Two tokens, two lifetimes
 *
 * - Access token: `POST api.tastytrade.com/oauth/token` with the refresh-token
 *   grant. Lives ~15 minutes; refreshed once fewer than 60 s remain.
 * - Streamer (quote) token: `GET api.tastyworks.com/api-quote-tokens` with the
 *   access token as Bearer. Lives ~24 hours; refreshed once fewer than 5
 *   minutes remain. It is what authenticates the dxLink websocket, and the
 *   same response names the websocket URL.
 *
 * Both are held in module memory for the life of the server instance and are
 * never serialised, logged, written to a store or returned to a caller outside
 * `lib/tasty`. The env vars are read with bracket access at request time.
 */

const OAUTH_URL = 'https://api.tastytrade.com/oauth/token';
const QUOTE_TOKEN_URL = 'https://api.tastyworks.com/api-quote-tokens';
export const TASTY_API_BASE = 'https://api.tastyworks.com';

const ACCESS_REFRESH_MARGIN_MS = 60_000;
const STREAMER_REFRESH_MARGIN_MS = 5 * 60_000;
const DEFAULT_ACCESS_TTL_MS = 15 * 60_000;
const DEFAULT_STREAMER_TTL_MS = 24 * 60 * 60_000;

function env(name: string): string | undefined {
  const key = name;
  return process.env[key]?.trim() || undefined;
}

export function tastyCredentialsPresent(): boolean {
  return Boolean(env('TASTY_CLIENT_SECRET') && env('TASTY_REFRESH_TOKEN'));
}

export class TastyAuthError extends Error {}

let access: { token: string; expiresAt: number } | null = null;
let accessInFlight: Promise<string> | null = null;
let streamer: { token: string; url: string; expiresAt: number } | null = null;
let streamerInFlight: Promise<{ token: string; url: string }> | null = null;

async function fetchAccessToken(): Promise<string> {
  const clientSecret = env('TASTY_CLIENT_SECRET');
  const refreshToken = env('TASTY_REFRESH_TOKEN');
  if (!clientSecret || !refreshToken) {
    throw new TastyAuthError('TASTY_CLIENT_SECRET / TASTY_REFRESH_TOKEN are not set.');
  }
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_secret: clientSecret });
  const clientId = env('TASTY_CLIENT_ID');
  if (clientId) body.set('client_id', clientId);

  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) throw new TastyAuthError(`Tastytrade OAuth answered ${res.status}.`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new TastyAuthError('Tastytrade OAuth returned no access token.');
  const ttl = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in * 1000 : DEFAULT_ACCESS_TTL_MS;
  access = { token: json.access_token, expiresAt: Date.now() + ttl };
  return json.access_token;
}

export async function getAccessToken(): Promise<string> {
  if (access && access.expiresAt - Date.now() > ACCESS_REFRESH_MARGIN_MS) return access.token;
  accessInFlight ??= fetchAccessToken().finally(() => {
    accessInFlight = null;
  });
  return accessInFlight;
}

async function fetchStreamerToken(): Promise<{ token: string; url: string }> {
  const bearer = await getAccessToken();
  const res = await fetch(QUOTE_TOKEN_URL, {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new TastyAuthError(`Tastytrade quote-token endpoint answered ${res.status}.`);
  const json = (await res.json()) as {
    data?: { token?: string; 'dxlink-url'?: string; 'expires-at'?: string };
  };
  const token = json.data?.token;
  const url = json.data?.['dxlink-url'];
  if (!token || !url) throw new TastyAuthError('Tastytrade returned no streamer token.');
  const parsed = json.data?.['expires-at'] ? Date.parse(json.data['expires-at']) : Number.NaN;
  const expiresAt = Number.isFinite(parsed) ? parsed : Date.now() + DEFAULT_STREAMER_TTL_MS;
  streamer = { token, url, expiresAt };
  return { token, url };
}

export async function getStreamerToken(): Promise<{ token: string; url: string }> {
  if (streamer && streamer.expiresAt - Date.now() > STREAMER_REFRESH_MARGIN_MS) {
    return { token: streamer.token, url: streamer.url };
  }
  streamerInFlight ??= fetchStreamerToken().finally(() => {
    streamerInFlight = null;
  });
  return streamerInFlight;
}

/** Drop the streamer token so the next connect fetches a fresh one (e.g. after an auth failure). */
export function invalidateStreamerToken(): void {
  streamer = null;
}
