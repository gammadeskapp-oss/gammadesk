/**
 * The pure heart of the scan: take the normalised items every source produced,
 * dedupe them, score and rank them, and pick the day's top 3–5. No IO, no
 * `server-only` — so `scripts/verify-news.mjs` drives this end to end without a
 * network.
 */

import { plainEnglish } from './headline';
import { isRankable, scoreItem, topCount } from './score';
import { sizeTierFor } from './universe';
import type { NewsSource, PickedStory, RawItem, ScoredItem } from './types';

/** Source trust order for dedupe: EDGAR (structured, public domain) wins. */
const SOURCE_TRUST: Record<NewsSource, number> = { edgar: 3, press: 2, polygon: 1 };

/**
 * Rank every candidate and split into the public top and the full ranked list.
 *
 * Dedupe is per (ticker, category): if a company both filed an 8-K and hit the
 * wire for the same kind of event, that is one story, kept from the most trusted
 * source — but the fact that a second source saw it marks the story as
 * *corroborated*, which nudges its score. Two genuinely different events for the
 * same company (a deal and a CEO change) stay as two stories.
 */
export function rankItems(
  raw: RawItem[],
  watch: Set<string>,
): { top: PickedStory[]; ranked: PickedStory[] } {
  // Which distinct sources named each ticker — the corroboration signal.
  const sourcesByTicker = new Map<string, Set<NewsSource>>();
  for (const item of raw) {
    if (!item.ticker) continue;
    const set = sourcesByTicker.get(item.ticker) ?? new Set<NewsSource>();
    set.add(item.source);
    sourcesByTicker.set(item.ticker, set);
  }

  // Dedupe per (ticker, category), keeping the most trusted source's copy.
  const best = new Map<string, RawItem>();
  for (const item of raw) {
    const key = `${item.ticker ?? '?'}:${item.category}`;
    const prev = best.get(key);
    if (!prev || SOURCE_TRUST[item.source] > SOURCE_TRUST[prev.source]) {
      best.set(key, item);
    }
  }

  const scored: ScoredItem[] = [];
  for (const item of best.values()) {
    const sizeTier = sizeTierFor(item.ticker, watch);
    const corroborated = (sourcesByTicker.get(item.ticker ?? '')?.size ?? 0) >= 2;
    const { score, tier } = scoreItem({ category: item.category, sizeTier, corroborated });
    if (!isRankable(tier, score)) continue;
    const plain = plainEnglish(item.category, item.company, item.ticker);
    scored.push({
      ...item,
      score,
      tier,
      sizeTier,
      headline: plain.headline,
      why: plain.why,
    });
  }

  scored.sort((a, b) => b.score - a.score || Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const ranked = scored.map(toPicked);
  const top = ranked.slice(0, topCount(ranked.length));
  return { top, ranked };
}

function toPicked(item: ScoredItem): PickedStory {
  return {
    ticker: item.ticker,
    company: item.company,
    headline: item.headline,
    why: item.why,
    url: item.url,
    timestamp: item.timestamp,
    source: item.source,
    category: item.category,
    score: item.score,
  };
}
