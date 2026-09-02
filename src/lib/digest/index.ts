import 'server-only';

import { cached } from '../cache';
import { sendToDiscord, type Delivery } from '../discord';
import { createJsonStore } from '../jsonStore';
import { marketNow } from '../time';
import { buildDigest, toDiscordMessage } from './build';
import type { Digest } from './types';

export { toDiscordMessage } from './build';
export { storeStatus } from '../jsonStore';

/** Digests kept in storage. Roughly a quarter of trading days. */
const KEEP = 60;

const store = createJsonStore<Digest[]>(
  'gammadesk/digests.json',
  () => [],
  (raw) => {
    if (Array.isArray(raw)) return raw as Digest[];
    if (raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)) {
      return (raw as { entries: Digest[] }).entries;
    }
    return null;
  },
);

function newestFirst(entries: Digest[]): Digest[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export async function readDigests(): Promise<Digest[]> {
  return newestFirst(await store.read().catch(() => []));
}

/**
 * Build today's digest and persist it, replacing any existing entry for the
 * same day so a re-run corrects rather than duplicates.
 */
export async function generateAndStoreDigest(): Promise<Digest> {
  const digest = await buildDigest();

  try {
    await store.update((current) =>
      newestFirst([...current.filter((d) => d.date !== digest.date), digest]).slice(0, KEEP),
    );
  } catch {
    // Storage failure must not lose the digest — it is still returned and can
    // still be delivered to Discord.
  }

  return digest;
}

/**
 * What `/digest` renders.
 *
 * Prefers the stored copy for today, so the page matches exactly what was sent
 * to Discord. Falls back to building one live — from already-cached sources —
 * when the scheduled run has not happened yet, rather than showing an empty
 * page for most of the day.
 */
export function getDigest(): Promise<{ digest: Digest; stored: boolean }> {
  return cached('digest:today', 900, async () => {
    const today = marketNow().date;
    const stored = (await readDigests()).find((d) => d.date === today);
    if (stored) return { digest: stored, stored: true };
    return { digest: await buildDigest(), stored: false };
  });
}

/**
 * Post a digest to Discord.
 *
 * The transport lives in `lib/discord.ts` — see the note there for why this is
 * no longer a copy of the morning post's version.
 */
export async function postToDiscord(digest: Digest): Promise<Delivery> {
  return sendToDiscord(toDiscordMessage(digest));
}
