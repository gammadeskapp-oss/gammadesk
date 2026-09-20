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
 * Email the report if it has failures and Gmail is configured. Returns what
 * happened rather than throwing — a mail failure must not crash the cron or
 * lose the stored result.
 */
export async function sendReportIfFailed(report: HealthReport): Promise<MailResult> {
  if (report.failed === 0) return { sent: false, skipped: 'All checks passed — no email sent.' };
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
    await transport.sendMail({
      from: `GammaDesk Health <${user}>`,
      to: RECIPIENT,
      subject: subjectFor(report.failed),
      text: emailBody(report),
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}
