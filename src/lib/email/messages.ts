/**
 * Pure builders for the email brief: address validation, the short plain-English
 * summary drawn from the morning brief, and the HTML/text bodies of the two
 * emails we send (double opt-in confirmation, and the daily brief).
 *
 * No `server-only` and no I/O, so `scripts/verify-email.mjs` drives every line
 * of copy and every legally-required footer element. The page and the Resend
 * client only arrange what these return.
 */

import type { Brief } from '../x/text';

/** Loose but practical email shape check. Full RFC parsing is not the point. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cased, trimmed email, or null when it is not a plausible address. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function signedPct(points: number): string {
  if (!Number.isFinite(points)) return '—';
  const sign = points >= 0 ? '+' : '';
  return `${sign}${points.toFixed(1)}%`;
}

/**
 * A handful of plain-English lines summarising the morning brief, for the email
 * body. Never invents a number: a non-finite field is shown as a dash by
 * `signedPct`, and an empty earnings list simply omits that line.
 */
export function briefSummaryLines(brief: Brief): string[] {
  const lines: string[] = [];
  lines.push(
    `S&P 500 (SPY) ${signedPct(brief.spy)} · Nasdaq (QQQ) ${signedPct(brief.qqq)} · Small caps (IWM) ${signedPct(brief.iwm)}`,
  );
  const mood = Number.isFinite(brief.vix) ? (brief.vix < 20 ? 'markets look calm' : 'markets look choppy') : null;
  lines.push(`Volatility (VIX) ${Number.isFinite(brief.vix) ? brief.vix.toFixed(1) : '—'}${mood ? ` — ${mood}` : ''}`);
  if (brief.topStory && brief.topStory.trim()) lines.push(brief.topStory.trim());
  const earnings = Array.isArray(brief.earningsToday)
    ? brief.earningsToday.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim())
    : [];
  if (earnings.length > 0) lines.push(`Reporting today: ${earnings.slice(0, 6).join(', ')}`);
  return lines;
}

/** Minimal HTML escaping for values interpolated into email bodies. */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const WRAP_OPEN = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0e17;">`;
const WRAP_CLOSE = `</div></body></html>`;

function footerHtml(opts: { unsubscribeHtml: string; mailingAddress: string }): string {
  return `<hr style="border:none;border-top:1px solid #e2e4e9;margin:28px 0 16px;">
<p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0 0 8px;">
You're receiving this because you signed up for the GammaDesk daily brief. ${opts.unsubscribeHtml}
</p>
<p style="font-size:12px;line-height:1.6;color:#9aa0aa;margin:0;">
${escapeHtml(opts.mailingAddress)}
</p>
<p style="font-size:11px;line-height:1.6;color:#9aa0aa;margin:8px 0 0;">
For informational and educational purposes only. Not financial advice.
</p>`;
}

// --- confirmation (double opt-in) --------------------------------------------

export interface ConfirmEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * The double opt-in email. Nothing is sent to a subscriber until they click the
 * button here, so this is deliberately plain: what it is, one button, and a
 * clear "ignore this if it wasn't you". It still carries an unsubscribe link
 * and the mailing address so it satisfies the same footer rules.
 */
export function buildConfirmEmail(opts: {
  confirmUrl: string;
  unsubscribeUrl: string;
  mailingAddress: string;
}): ConfirmEmail {
  const subject = 'Confirm your GammaDesk daily brief';
  const unsubscribeHtml = `<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a>.`;
  const html = `${WRAP_OPEN}
<p style="font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#16a34a;margin:0 0 8px;">GammaDesk</p>
<h1 style="font-size:22px;margin:0 0 12px;">Confirm your email</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#374151;">
Tap the button to start getting the GammaDesk morning brief — the day's market map in plain English, every trading day.
</p>
<p style="margin:0 0 24px;">
<a href="${escapeHtml(opts.confirmUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px;">Confirm my email</a>
</p>
<p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 8px;">
If the button doesn't work, paste this link into your browser:<br>
<a href="${escapeHtml(opts.confirmUrl)}" style="color:#16a34a;word-break:break-all;">${escapeHtml(opts.confirmUrl)}</a>
</p>
<p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0;">
Didn't sign up? Just ignore this email — you won't hear from us again.
</p>
${footerHtml({ unsubscribeHtml, mailingAddress: opts.mailingAddress })}
${WRAP_CLOSE}`;
  const text = [
    'Confirm your GammaDesk daily brief',
    '',
    'Tap to start getting the GammaDesk morning brief (plain-English market map, every trading day):',
    opts.confirmUrl,
    '',
    "Didn't sign up? Just ignore this email — you won't hear from us again.",
    '',
    `Unsubscribe: ${opts.unsubscribeUrl}`,
    opts.mailingAddress,
    'For informational and educational purposes only. Not financial advice.',
  ].join('\n');
  return { subject, html, text };
}

// --- daily brief -------------------------------------------------------------

export interface BriefEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * The daily brief email. Sent as a Resend broadcast, so the unsubscribe link is
 * Resend's managed one-click token — passed in as `unsubscribeHtml` — which
 * keeps us from ever handling the subscriber list ourselves.
 *
 * `posterUrl` is the morning poster image; `dailyUrl` links to /daily.
 */
export function buildBriefEmail(opts: {
  date: string;
  summaryLines: string[];
  posterUrl: string | null;
  dailyUrl: string;
  unsubscribeHtml: string;
  mailingAddress: string;
}): BriefEmail {
  const subject = `GammaDesk morning brief — ${opts.date}`;
  const poster = opts.posterUrl
    ? `<p style="margin:0 0 20px;"><img src="${escapeHtml(opts.posterUrl)}" alt="GammaDesk morning poster for ${escapeHtml(opts.date)}" style="width:100%;height:auto;border-radius:8px;display:block;"></p>`
    : '';
  const bullets = opts.summaryLines
    .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line)}</li>`)
    .join('');
  const html = `${WRAP_OPEN}
<p style="font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#16a34a;margin:0 0 8px;">GammaDesk · Morning brief</p>
<h1 style="font-size:22px;margin:0 0 16px;">Today&rsquo;s market map</h1>
${poster}
<ul style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 22px;padding-left:20px;">${bullets}</ul>
<p style="margin:0 0 8px;">
<a href="${escapeHtml(opts.dailyUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px;">See today&rsquo;s full map →</a>
</p>
${footerHtml({ unsubscribeHtml: opts.unsubscribeHtml, mailingAddress: opts.mailingAddress })}
${WRAP_CLOSE}`;
  const text = [
    `GammaDesk morning brief — ${opts.date}`,
    '',
    ...opts.summaryLines.map((l) => `• ${l}`),
    '',
    `See today's full map: ${opts.dailyUrl}`,
    '',
    opts.mailingAddress,
    'For informational and educational purposes only. Not financial advice.',
  ].join('\n');
  return { subject, html, text };
}
