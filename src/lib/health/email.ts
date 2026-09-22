import 'server-only';

import nodemailer from 'nodemailer';
import { emailBody, subjectFor, type HealthReport } from './report';

/**
 * Sends the nightly health report by email — but only ever when something
 * failed. Silence is the healthy state.
 *
 * Reuses the existing Gmail app-password setup (GMAIL_USER / GMAIL_APP_PASSWORD,
 * the same pair the TOS reader signs in with) over Gmail's SMTP, so no new
 * secret is introduced.
 */

const RECIPIENT = 'gammadesk.app@gmail.com';

export function gmailConfigured(): boolean {
  return Boolean(process.env['GMAIL_USER']?.trim() && process.env['GMAIL_APP_PASSWORD']?.trim());
}

export interface MailResult {
  sent: boolean;
  skipped?: string;
  error?: string;
}

/**
 * Send one email to the owner over the shared Gmail transport. Returns what
 * happened rather than throwing — a mail failure must never crash the caller
 * (a cron, or the X poster mid-pause) or lose its stored result.
 */
export async function sendOwnerEmail(subject: string, text: string): Promise<MailResult> {
  if (!gmailConfigured()) {
    return { sent: false, skipped: 'GMAIL_USER / GMAIL_APP_PASSWORD not set — cannot send.' };
  }

  const user = (process.env['GMAIL_USER'] ?? '').trim();
  // Gmail app passwords are shown in groups of four with spaces; strip them.
  const pass = (process.env['GMAIL_APP_PASSWORD'] ?? '').replace(/\s+/g, '');

  try {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    await transport.sendMail({ from: `GammaDesk Health <${user}>`, to: RECIPIENT, subject, text });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Email the report if it has failures and Gmail is configured. Returns what
 * happened rather than throwing — a mail failure must not crash the cron or
 * lose the stored result.
 */
export async function sendReportIfFailed(report: HealthReport): Promise<MailResult> {
  if (report.failed === 0) return { sent: false, skipped: 'All checks passed — no email sent.' };
  return sendOwnerEmail(subjectFor(report.failed), emailBody(report));
}

/**
 * Immediate alert when the X poster auto-pauses — sent the moment it happens,
 * not held for the nightly run, because an auto-pause silences posting for the
 * rest of the day and only a human can clear it. Never throws.
 */
export async function sendAutoPauseAlert(reason: string, at: Date = new Date()): Promise<MailResult> {
  const subject = 'GammaDesk: X posting AUTO-PAUSED';
  const text = [
    'X posting was just auto-paused, so no further posts will go out until it is resumed.',
    '',
    `When: ${at.toISOString()}`,
    `Reason: ${reason}`,
    '',
    'This is almost always an X API auth or billing problem (e.g. a 403 on a',
    'read-only token, or a lapsed access tier). Fix it in the X developer portal,',
    'then resume posting at https://www.gammadesk.app/admin/x-posts',
    '',
    'Status any time: https://www.gammadesk.app/api/health  (see the xPosting block).',
  ].join('\n');
  return sendOwnerEmail(subject, text);
}

/**
 * Immediate alert when a single slot is skipped (an image X refused, a duplicate,
 * a rate limit, a timeout, a missing brief). Posting is NOT paused — the one post
 * did not go out and the poster carries on — so this is informational, one email
 * per skipped slot. Never throws.
 */
export async function sendSkipAlert(slot: string, reason: string, at: Date = new Date()): Promise<MailResult> {
  const subject = `GammaDesk: X ${slot} post skipped`;
  const text = [
    `The X "${slot}" post was skipped. Posting is NOT paused — the other slots today will still go out.`,
    '',
    `When: ${at.toISOString()}`,
    `Slot: ${slot}`,
    `Reason: ${reason}`,
    '',
    'Full log for today: https://www.gammadesk.app/admin/x-posts',
    'Status: https://www.gammadesk.app/api/health  (see the xPosting block).',
  ].join('\n');
  return sendOwnerEmail(subject, text);
}
