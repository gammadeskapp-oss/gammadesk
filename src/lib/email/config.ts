import 'server-only';

/**
 * Environment for the free email brief.
 *
 * Subscribers are stored in a Resend Audience — never in our own storage — so
 * the app holds no list of email addresses. All this module needs is the
 * Resend credentials, the "from" identity, a secret for signing the
 * confirm/unsubscribe links, and the physical mailing address that US law
 * (CAN-SPAM) requires in the footer of every commercial email.
 *
 * Nothing here is `NEXT_PUBLIC_`, so the API key never reaches the browser.
 *
 * Env vars (set on the Vercel project):
 *   RESEND_API_KEY        — Resend API key (server-only).
 *   RESEND_AUDIENCE_ID    — the Audience subscribers are stored in.
 *   EMAIL_FROM            — e.g. "GammaDesk <brief@gammadesk.app>".
 *   EMAIL_TOKEN_SECRET    — HMAC secret for confirm/unsubscribe links.
 *   EMAIL_MAILING_ADDRESS — physical postal address for the email footer.
 *   EMAIL_SITE_URL        — optional; overrides the public origin (previews).
 *   CRON_SECRET           — already used by the other crons; guards the send.
 */

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  return trimmed ? trimmed : null;
}

/** A placeholder is shipped so the footer is never legally empty in a preview. */
export const MAILING_ADDRESS_PLACEHOLDER =
  'GammaDesk — [ADD YOUR BUSINESS MAILING ADDRESS] — Street, City, ST ZIP, USA';

export interface EmailConfig {
  apiKey: string | null;
  audienceId: string | null;
  from: string | null;
  tokenSecret: string | null;
  mailingAddress: string;
  siteUrl: string;
}

export function emailConfig(): EmailConfig {
  return {
    apiKey: readEnv('RESEND_API_KEY'),
    audienceId: readEnv('RESEND_AUDIENCE_ID'),
    from: readEnv('EMAIL_FROM'),
    tokenSecret: readEnv('EMAIL_TOKEN_SECRET'),
    mailingAddress: readEnv('EMAIL_MAILING_ADDRESS') ?? MAILING_ADDRESS_PLACEHOLDER,
    siteUrl: readEnv('EMAIL_SITE_URL') ?? 'https://gammadesk.app',
  };
}

/**
 * Everything the signup + confirm flow needs. The mailing address is allowed
 * to fall back to the placeholder, so it is not part of "configured".
 */
export function emailEnabled(): boolean {
  const c = emailConfig();
  return Boolean(c.apiKey && c.audienceId && c.from && c.tokenSecret);
}

/** A human-readable list of what is missing, for the admin page and /status. */
export function emailDiagnostic(): string[] {
  const c = emailConfig();
  const missing: string[] = [];
  if (!c.apiKey) missing.push('RESEND_API_KEY');
  if (!c.audienceId) missing.push('RESEND_AUDIENCE_ID');
  if (!c.from) missing.push('EMAIL_FROM');
  if (!c.tokenSecret) missing.push('EMAIL_TOKEN_SECRET');
  return missing;
}
