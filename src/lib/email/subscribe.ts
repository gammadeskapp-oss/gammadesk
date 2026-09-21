import 'server-only';

import { emailConfig } from './config';
import { buildConfirmEmail, normaliseEmail } from './messages';
import { createPendingContact, sendTransactionalEmail, setContactSubscribed } from './resend';
import { signEmailToken, verifyEmailToken } from './token';

/**
 * The double opt-in signup flow, tying together the Resend Audience, the signed
 * links, and the confirmation email.
 *
 * Nothing reaches a new subscriber until they confirm: the contact is created
 * `unsubscribed` (so no broadcast can reach them), and only a valid confirm
 * link flips them to subscribed. No pending state is stored anywhere — the
 * confirm link carries it, signed.
 */

function tokenSecret(): string {
  const secret = emailConfig().tokenSecret;
  if (!secret) throw new Error('EMAIL_TOKEN_SECRET is not set.');
  return secret;
}

function confirmUrl(email: string): string {
  const { siteUrl } = emailConfig();
  const token = signEmailToken({ email, purpose: 'confirm' }, tokenSecret());
  return `${siteUrl}/api/email/confirm?token=${encodeURIComponent(token)}`;
}

/** A durable, self-signing unsubscribe URL for one email (never expires). */
export function unsubscribeUrl(email: string): string {
  const { siteUrl } = emailConfig();
  const token = signEmailToken({ email, purpose: 'unsubscribe' }, tokenSecret());
  return `${siteUrl}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

export interface SubscribeResult {
  ok: boolean;
  /** Safe to show the reader. */
  message: string;
}

/**
 * Step one of double opt-in: validate, create the pending contact, and send the
 * confirmation email.
 *
 * The reader-facing message is intentionally the same whether or not the
 * address was already known, so this endpoint cannot be used to probe who is
 * subscribed.
 */
export async function requestSubscription(rawEmail: string): Promise<SubscribeResult> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, message: 'That doesn’t look like a valid email address.' };

  const c = emailConfig();
  const email_msg = 'Almost there — check your inbox for a confirmation link.';

  // Create pending first; if that fails we don't send a confirm they can't use.
  await createPendingContact(email);

  const { html, text, subject } = buildConfirmEmail({
    confirmUrl: confirmUrl(email),
    unsubscribeUrl: unsubscribeUrl(email),
    mailingAddress: c.mailingAddress,
  });

  await sendTransactionalEmail({
    to: email,
    subject,
    html,
    text,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl(email)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });

  return { ok: true, message: email_msg };
}

export interface ConfirmResult {
  ok: boolean;
  email?: string;
  reason?: string;
}

/** Step two: verify the confirm link and flip the contact to subscribed. */
export async function confirmSubscription(token: string | null | undefined): Promise<ConfirmResult> {
  const result = verifyEmailToken(token, 'confirm', tokenSecret());
  if (!result.ok || !result.email) return { ok: false, reason: result.reason };
  await setContactSubscribed(result.email, true);
  return { ok: true, email: result.email };
}

/** Unsubscribe by our own signed link (Resend broadcasts use their own too). */
export async function unsubscribeByToken(token: string | null | undefined): Promise<ConfirmResult> {
  const result = verifyEmailToken(token, 'unsubscribe', tokenSecret());
  if (!result.ok || !result.email) return { ok: false, reason: result.reason };
  await setContactSubscribed(result.email, false);
  return { ok: true, email: result.email };
}
