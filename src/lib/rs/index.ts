import 'server-only';

import { cached } from '../cache';
import { peekStoredGroups } from '../groups';
import { peekStoredSectors } from '../sectors';
import { getMembership } from './membership';
import { digestStore, refreshShard, metaStore } from './refresh';
import { rankUniverse, type SignalLookup } from './rank';
import { SHARDS, sectorMap, type Gics } from './universe';
import {
  DEFAULT_MIN_DOLLAR_VOLUME,
  type DigestEntry,
  type RsResult,
  type Weights,
} from './types';

export { storeStatus } from '../jsonStore';

/** In-process reuse, so a burst of views shares one set of store reads. */
const MEMO_SECONDS = 900;

/**
 * The read path for /strength.
 *
 * Page views read only the four digest documents — a few hundred numbers each
 * — never the bar shards, which are megabytes and exist solely so the digests
 * can be recomputed. Percentile ranking and the weighted blend then happen per
 * request, which is what lets the weight controls respond instantly without
 * anything being refetched or recomputed upstream.
 */

/**
 * The nine-signal scores, for the secondary column.
 *
 * Read from whatever the /sectors and /groups jobs last stored, and never
 * computed here: those engines fan out over a rate-limited price API, and a
 * visit to this page must not be able to set that off. Coverage is therefore
 * partial by design — a few dozen names from the groups universe plus the
 * sector constituents, out of five hundred. The column shows a dash for the
 * rest rather than pretending to a number.
 */
async function signalLookup(): Promise<{
  lookup: SignalLookup;
  map: Record<string, { score: number; bullish: number; total: number }>;
  covered: number;
}> {
  const [groups, sectors] = await Promise.all([
    peekStoredGroups().catch(() => null),
    peekStoredSectors().catch(() => null),
  ]);

  const map = new Map<string, { score: number; bullish: number; total: number }>();

  const add = (symbol: string, bullish: number, total: number) => {
    if (total <= 0 || map.has(symbol)) return;
    map.set(symbol, { score: Math.round((bullish / total) * 100), bullish, total });
  };

  for (const group of groups?.groups ?? []) {
    for (const m of group.members) add(m.symbol, m.bullish, m.total);
  }
  for (const sector of sectors?.sectors ?? []) {
    for (const m of sector.members) add(m.symbol, m.bullish, m.total);
  }

  return {
    lookup: { get: (s) => map.get(s) },
    map: Object.fromEntries(map),
    covered: map.size,
  };
}

async function readDigests(): Promise<{
  entries: DigestEntry[];
  dates: string[];
  missingShards: number[];
}> {
  const docs = await Promise.all(
    Array.from({ length: SHARDS }, (_, shard) =>
      digestStore(shard).read().catch(() => null),
    ),
  );

  const entries: DigestEntry[] = [];
  const dates: string[] = [];
  const missingShards: number[] = [];

  docs.forEach((doc, shard) => {
    if (!doc || doc.entries.length === 0) {
      missingShards.push(shard);
      return;
    }
    entries.push(...doc.entries);
    for (const e of doc.entries) dates.push(e.asOfDate);
  });

  return { entries, dates, missingShards };
}

/**
 * Read everything the ranking needs, once.
 *
 * Memoised because it does not depend on the weights or the liquidity floor —
 * those are applied afterwards, so a reader adjusting either never causes a
 * storage read.
 */
function loadInputs() {
  return cached('rs:inputs', MEMO_SECONDS, async () => {
    const membership = await getMembership();
    let digests = await readDigests();

    /*
     * Nothing stored at all — a fresh deploy, or before the first cron fires.
     * One shard is refreshed inline so the page is not blank, which fills in
     * roughly a quarter of the index; the rest arrives as the cron walks the
     * remaining shards. Deliberately capped at one: a page view must never
     * turn into five hundred upstream requests.
     */
    if (digests.entries.length === 0) {
      try {
        await refreshShard();
        digests = await readDigests();
      } catch {
        // Serve an empty page with its explanation rather than throwing.
      }
    }

    return {
      ...digests,
      membership,
      signals: await signalLookup(),
      universe: membership.members.length,
    };
  });
}

/**
 * Everything worth telling the reader about the state of the data.
 *
 * Shared by both entry points so the page cannot show one set of caveats while
 * an API response shows another.
 */
function buildNotes(input: {
  membership: Awaited<ReturnType<typeof getMembership>>;
  missingShards: number[];
  /** Session dates across the shards, sorted. */
  dates: string[];
  ranked: number;
  signalCoverage: number;
}): string[] {
  const { membership, missingShards, dates, ranked, signalCoverage } = input;
  const notes = [...membership.notes];

  if (missingShards.length > 0 && missingShards.length < SHARDS) {
    notes.push(
      `${missingShards.length} of ${SHARDS} storage shards have not been built yet, so part of the index is still missing. The nightly job fills one shard per run.`,
    );
  }

  const newest = dates[dates.length - 1] ?? '';
  const oldest = dates[0] ?? '';
  if (oldest && newest && oldest !== newest) {
    notes.push(
      `Shards were last refreshed on different sessions (${oldest} to ${newest}), so a few names are priced a day behind the rest.`,
    );
  }

  if (membership.removed.length > 0 || membership.added.length > 0) {
    const parts: string[] = [];
    if (membership.added.length > 0) parts.push(`added ${membership.added.join(', ')}`);
    if (membership.removed.length > 0) {
      parts.push(`removed ${membership.removed.join(', ')}`);
    }
    notes.push(`Latest index membership update: ${parts.join('; ')}.`);
  }

  if (signalCoverage > 0 && signalCoverage < ranked) {
    notes.push(
      `The nine-signal score covers ${signalCoverage} of the ${ranked} ranked names — it is computed by the /sectors and /groups jobs, which track a smaller universe.`,
    );
  }

  return notes;
}

/** Rank the universe at the given weights and liquidity floor. */
export async function getRsResult(
  weights: Weights,
  minDollarVolume = DEFAULT_MIN_DOLLAR_VOLUME,
): Promise<RsResult> {
  const { entries, dates, missingShards, membership, signals, universe } =
    await loadInputs();

  const rows = rankUniverse(entries, weights, {
    sectors: sectorMap(membership.members),
    signals: signals.lookup,
    minDollarVolume,
  });

  const sorted = [...dates].sort();
  const newest = sorted[sorted.length - 1] ?? '';
  const oldest = sorted[0] ?? '';

  const notes = buildNotes({
    membership,
    missingShards,
    dates: sorted,
    ranked: rows.length,
    signalCoverage: signals.covered,
  });

  const illiquid = entries.filter((e) => e.avgDollarVolume < minDollarVolume).length;

  if (illiquid > 0) {
    notes.push(
      `${illiquid} names trade under the $${(minDollarVolume / 1e6).toFixed(0)}M/day liquidity floor and are left out of the ranking entirely, so they cannot displace tradeable names in the percentiles.`,
    );
  }

  return {
    rows,
    ranked: rows.length,
    illiquid,
    pending: Math.max(0, universe - entries.length),
    universe,
    asOfDate: newest,
    oldestShardDate: oldest,
    computedAt: new Date().toISOString(),
    weights,
    minDollarVolume,
    notes,
  };
}

/**
 * Everything the board needs to rank in the browser.
 *
 * The digest entries are the raw material — a few hundred bytes a symbol — and
 * shipping them instead of finished rows is what lets the liquidity floor be
 * adjustable at all. Changing the floor changes which stocks are in the
 * percentile pool, so it cannot be applied to an already-ranked list; the
 * ranking has to be redone, and redoing it locally beats a round-trip per
 * click.
 */
export interface RsInputs {
  entries: DigestEntry[];
  /** Plain objects rather than Maps, because these cross to a client component. */
  sectors: Record<string, Gics>;
  signals: Record<string, { score: number; bullish: number; total: number }>;
  universe: number;
  asOfDate: string;
  computedAt: string;
  notes: string[];
}

export async function getRsInputs(): Promise<RsInputs> {
  const { entries, dates, missingShards, membership, signals, universe } =
    await loadInputs();

  const sorted = [...dates].sort();

  return {
    entries,
    sectors: Object.fromEntries(sectorMap(membership.members)),
    signals: signals.map,
    universe,
    asOfDate: sorted[sorted.length - 1] ?? '',
    computedAt: new Date().toISOString(),
    notes: buildNotes({
      membership,
      missingShards,
      dates: sorted,
      ranked: entries.length,
      signalCoverage: signals.covered,
    }),
  };
}

/** Refresh state, for the health check. */
export async function peekRsMeta() {
  return metaStore.read().catch(() => null);
}
