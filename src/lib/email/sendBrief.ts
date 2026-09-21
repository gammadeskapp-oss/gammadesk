import 'server-only';

import { readBriefForDate } from '../x/brief';
import { readImageMeta } from '../x/imageStore';
import { emailConfig } from './config';
import { buildBriefEmail, briefSummaryLines } from './messages';
import { alreadySentToday, markSent } from './sendMarker';
import { RESEND_UNSUBSCRIBE_VARIABLE, sendBroadcast } from './resend';

/**
 * Compose and send the daily brief email to the Resend audience.
 *
 * The one hard rule from the brief: if there is no morning brief for today,
 * send nothing. A brief email with no brief in it would be worse than silence.
 * The twin-cron double-send is guarded by the send marker.
 *
 * Sent as a broadcast, so Resend fans it out and appends its managed one-click
 * unsubscribe — we never pull the subscriber list down to send.
 */

export type SendOutcome =
  | { sent: false; reason: 'no-brief' | 'already-sent' | 'not-configured' }
  | { sent: true; broadcastId: string; date: string };

export async function sendDailyBrief(
  date: string,
  options: { force?: boolean } = {},
): Promise<SendOutcome> {
  const c = emailConfig();
  if (!c.apiKey || !c.audienceId || !c.from || !c.tokenSecret) {
    return { sent: false, reason: 'not-configured' };
  }

  const brief = await readBriefForDate(date).catch(() => null);
  if (!brief) return { sent: false, reason: 'no-brief' };

  if (!options.force && (await alreadySentToday(date))) {
    return { sent: false, reason: 'already-sent' };
  }

  // The poster image is served by our public route only if it actually exists;
  // the email degrades to a text-only summary rather than a broken image.
  const posterMeta = await readImageMeta(date, 'morning').catch(() => null);
  const posterUrl = posterMeta ? `${c.siteUrl}/api/email/poster/${date}` : null;

  const { subject, html, text } = buildBriefEmail({
    date,
    summaryLines: briefSummaryLines(brief),
    posterUrl,
    dailyUrl: `${c.siteUrl}/daily`,
    // Resend swaps this variable for a per-recipient one-click unsubscribe URL.
    unsubscribeHtml: `<a href="${RESEND_UNSUBSCRIBE_VARIABLE}" style="color:#6b7280;">Unsubscribe</a>.`,
    mailingAddress: c.mailingAddress,
  });

  const { id } = await sendBroadcast({ subject, html, text, name: `Morning brief ${date}` });
  await markSent(date);
  return { sent: true, broadcastId: id, date };
}
