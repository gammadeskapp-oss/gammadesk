import 'server-only';

import { cached } from '../cache';
import { createJsonStore } from '../jsonStore';
import { marketToday } from '../time';
import { getDigest } from '../digest';
import { buildMorningPost, toDiscordMessage } from './build';
import type { MorningPost } from './types';

export { toDiscordMessage, X_LIMIT } from './build';

/**
 * The Discord message with the day's narrative folded in.
 *
 * The digest is built live from already-cached sources, since the morning run
 * fires hours before the digest job stores one. A failure here is not fatal:
 * the post still goes out, just without the paragraphs under it.
 */
export async function buildDiscordMessage(post: MorningPost): Promise<string> {
  const digest = await getDigest()
    .then((r) => r.digest)
    .catch(() => null);
  return toDiscordMessage(post, digest);
}
export { storeStatus } from '../jsonStore';
export type { MorningPost } from './types';

/** Posts kept in storage. Roughly a quarter of trading days. */
const KEEP = 60;

const store = createJsonStore<MorningPost[]>(
  'gammadesk/posts.json',
  () => [],
  (raw) => (Array.isArray(raw) ? (raw as MorningPost[]) : null),
);

function newestFirst(entries: MorningPost[]): MorningPost[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export async function readPosts(): Promise<MorningPost[]> {
  return newestFirst(await store.read().catch(() => []));
}

/**
 * Build today's post and persist it, replacing any entry for the same day so a
 * re-run corrects rather than duplicates.
 */
export async function generateAndStorePost(): Promise<MorningPost> {
  const post = await buildMorningPost();

  try {
    await store.update((current) =>
      newestFirst([...current.filter((p) => p.date !== post.date), post]).slice(0, KEEP),
    );
  } catch {
    // Storage failure must not lose the post — it is still returned and can
    // still be delivered.
  }

  return post;
}

/**
 * What `/post` renders.
 *
 * Prefers the stored copy for today so the page shows exactly what went to
 * Discord. Falls back to building one live, from the already-cached chain,
 * rather than showing an empty page before the morning run — but deliberately
 * does not post anything: a page view must never be able to write to a
 * channel.
 */
export function getMorningPost(): Promise<{ post: MorningPost; stored: boolean }> {
  return cached('post:today', 600, async () => {
    const today = marketToday();
    const stored = (await readPosts()).find((p) => p.date === today);
    if (stored) return { post: stored, stored: true };
    return { post: await buildMorningPost(), stored: false };
  });
}

/**
 * Post to Discord.
 *
 * The webhook URL is a credential — anyone holding it can post to the channel
 * — so it is read server-side only and never returned to a caller.
 */
export async function postToDiscord(
  post: MorningPost,
): Promise<{ delivered: boolean; reason?: string }> {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) {
    return { delivered: false, reason: 'DISCORD_WEBHOOK_URL is not set.' };
  }
  if (!/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(url)) {
    return {
      delivered: false,
      reason: 'DISCORD_WEBHOOK_URL does not look like a Discord webhook URL.',
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: await buildDiscordMessage(post),
        // The post mentions nobody; suppress pings outright so a ticker that
        // happens to match a role name cannot notify a channel.
        allowed_mentions: { parse: [] },
      }),
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
