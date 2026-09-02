import 'server-only';

import { cached } from '../cache';
import { sendToDiscord, type Delivery } from '../discord';
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
 * Post the morning post to Discord.
 *
 * The transport lives in `lib/discord.ts` — see the note there for why this is
 * no longer a copy of the digest's version.
 */
export async function postToDiscord(post: MorningPost): Promise<Delivery> {
  return sendToDiscord(await buildDiscordMessage(post));
}
