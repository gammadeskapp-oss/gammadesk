import 'server-only';

/**
 * The one place that talks to Discord.
 *
 * The morning post and the digest each grew their own copy of this function,
 * byte-identical apart from the line that produced the message. That is the
 * shape of duplication that stays correct right up until it doesn't: a fix to
 * the timeout, the mention suppression, or the URL check lands in one of them
 * and silently not the other. The alarm added below would have made three.
 *
 * The webhook URL is a credential — anyone holding it can post to the channel
 * — so it is read server-side only and never returned to a caller. That is
 * also why failures come back as a `reason` string rather than a thrown error
 * carrying the URL in a stack trace.
 */

export interface Delivery {
  delivered: boolean;
  reason?: string;
}

/** Discord's hard limit on a webhook message body. */
const MAX_CONTENT = 2000;

const WEBHOOK_PATTERN =
  /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//i;

/**
 * Send one message to the configured channel.
 *
 * Mentions are suppressed outright rather than escaped. Every caller here
 * writes about tickers and job names, and a symbol or path that happens to
 * collide with a role name must not be able to notify a channel.
 */
export async function sendToDiscord(content: string): Promise<Delivery> {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) {
    return { delivered: false, reason: 'DISCORD_WEBHOOK_URL is not set.' };
  }
  if (!WEBHOOK_PATTERN.test(url)) {
    return {
      delivered: false,
      reason: 'DISCORD_WEBHOOK_URL does not look like a Discord webhook URL.',
    };
  }

  /*
   * Truncated rather than rejected. A message that grew past the limit is
   * still worth delivering — an alarm naming six of eight late jobs beats a
   * 400 from Discord and nothing in the channel — and the marker says plainly
   * that there is more.
   */
  const body =
    content.length > MAX_CONTENT
      ? `${content.slice(0, MAX_CONTENT - 3)}...`
      : content;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return { delivered: false, reason: `Discord returned HTTP ${res.status}.` };
    }
    return { delivered: true };
  } catch (error) {
    return {
      delivered: false,
      reason: error instanceof Error ? error.message : 'Discord request failed.',
    };
  }
}

/** True when a webhook is configured and looks usable. */
export function discordConfigured(): boolean {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  return Boolean(url) && WEBHOOK_PATTERN.test(url as string);
}
