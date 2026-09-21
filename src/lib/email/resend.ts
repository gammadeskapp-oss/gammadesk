import 'server-only';

import { emailConfig } from './config';

/**
 * A thin Resend REST client, used through `fetch` so the project takes on no
 * new dependency and the API key stays server-side.
 *
 * Resend renamed Audiences to Segments: contacts are now global (top-level
 * `/contacts`) and organised into segments, rather than living under an
 * audience. `RESEND_AUDIENCE_ID` now holds a *segment* id — the env var keeps
 * its name so no Vercel setting has to change. This module is the *only* place
 * the app talks to that list, and it never copies it into our own storage. The
 * daily brief goes out as a Resend broadcast targeting the segment, so even the
 * send never pulls the addresses down — Resend fans it out and appends its
 * managed one-click unsubscribe.
 */

const BASE = 'https://api.resend.com';

class ResendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ResendError';
  }
}

function requireConfig() {
  const c = emailConfig();
  if (!c.apiKey || !c.audienceId || !c.from) {
    throw new ResendError('Email is not configured (RESEND_API_KEY / RESEND_AUDIENCE_ID / EMAIL_FROM).', 503);
  }
  return c as { apiKey: string; audienceId: string; from: string } & typeof c;
}

async function call<T>(path: string, init: RequestInit & { apiKey: string }): Promise<T> {
  const { apiKey, ...rest } = init;
  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(rest.headers ?? {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  const bodyText = await response.text();
  const body = bodyText ? (JSON.parse(bodyText) as unknown) : null;

  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new ResendError(`Resend ${path} failed: ${detail}`, response.status);
  }
  return body as T;
}

export interface ResendContact {
  id: string;
  email: string;
  unsubscribed: boolean;
  created_at?: string;
}

/**
 * Create the contact as unsubscribed (pending) and place it in our segment, or
 * leave an existing one as it is. Idempotent: a second signup for the same
 * address does not resurrect a confirmed contact as pending, because Resend
 * keys on the email and a 409 / already-exists is treated as success (a repeat
 * signup is always someone who already went through this same segment).
 */
export async function createPendingContact(email: string): Promise<void> {
  const c = requireConfig();
  try {
    await call('/contacts', {
      apiKey: c.apiKey,
      method: 'POST',
      body: JSON.stringify({
        email,
        // unsubscribed:true means no broadcast will reach them until they confirm.
        unsubscribed: true,
        // `segments` takes an array of { id } — this is what puts the signup
        // into the segment named by RESEND_AUDIENCE_ID.
        segments: [{ id: c.audienceId }],
      }),
    });
  } catch (error) {
    // An address already known to Resend is not an error for our purposes.
    if (error instanceof ResendError && (error.status === 409 || error.status === 422)) return;
    throw error;
  }
}

/**
 * Flip a contact's subscribed state. Confirming sets subscribed = true.
 * Contacts are global now, so this is a top-level PATCH by email.
 */
export async function setContactSubscribed(email: string, subscribed: boolean): Promise<void> {
  const c = requireConfig();
  await call(`/contacts/${encodeURIComponent(email)}`, {
    apiKey: c.apiKey,
    method: 'PATCH',
    body: JSON.stringify({ unsubscribed: !subscribed }),
  });
}

/** The segment's contacts, for the owner-only admin list. */
export async function listContacts(): Promise<ResendContact[]> {
  const c = requireConfig();
  const body = await call<{ data?: ResendContact[] }>(
    `/contacts?segment_id=${encodeURIComponent(c.audienceId)}`,
    {
      apiKey: c.apiKey,
      method: 'GET',
    },
  );
  return body.data ?? [];
}

/**
 * Reply-to for every brief email. Resend sends from the `EMAIL_FROM` identity
 * (a domain that may not accept inbound mail), so replies are pointed at a real
 * monitored inbox instead of bouncing.
 */
export const BRIEF_REPLY_TO = 'gammadesk.app@gmail.com';

/** Send a one-off transactional email (the confirmation). */
export async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const c = requireConfig();
  await call('/emails', {
    apiKey: c.apiKey,
    method: 'POST',
    body: JSON.stringify({
      from: c.from,
      to: [opts.to],
      reply_to: BRIEF_REPLY_TO,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      headers: opts.headers,
    }),
  });
}

/**
 * The token Resend replaces with a per-recipient one-click unsubscribe URL when
 * a broadcast is sent. Put this in the broadcast HTML and Resend handles the
 * whole unsubscribe flow, so we never see the address.
 */
export const RESEND_UNSUBSCRIBE_VARIABLE = '{{{RESEND_UNSUBSCRIBE_URL}}}';

/** Create a broadcast to the whole segment and send it immediately. */
export async function sendBroadcast(opts: {
  subject: string;
  html: string;
  text: string;
  name: string;
}): Promise<{ id: string }> {
  const c = requireConfig();
  const created = await call<{ id: string }>('/broadcasts', {
    apiKey: c.apiKey,
    method: 'POST',
    body: JSON.stringify({
      // Broadcasts now target a segment, not an audience.
      segment_id: c.audienceId,
      from: c.from,
      reply_to: BRIEF_REPLY_TO,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      name: opts.name,
    }),
  });
  await call(`/broadcasts/${created.id}/send`, {
    apiKey: c.apiKey,
    method: 'POST',
    body: JSON.stringify({}),
  });
  return created;
}
