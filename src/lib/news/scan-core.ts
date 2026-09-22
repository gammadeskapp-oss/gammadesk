/**
 * The pure heart of the scan: take the normalised items every source produced,
 * dedupe them, score and rank them, and pick the day's top 3–5. No IO, no
 * `server-only` — so `scripts/verify-news.mjs` drives this end to end without a
 * network.
 */

import { isRankable, scoreItem, topCount } from './score';
import { sizeTierFor } from './universe';
import type { NewsSource, PickedStory, RawItem, ScoredItem } from './types';

/**
 * Rank every candidate and split into the public top and the full ranked list.
 *
 * Only *enriched* items are surfaced — an EDGAR filing whose real text was read
 * and turned into a specific story. A wire or press item has no fetchable
 * public-domain body, so it is never surfaced on its own; it counts only toward
 * corroboration (a second independent source naming the same ticker nudges the
 * score of the enriched story).
 *
 * Dedupe is per (ticker, category): two genuinely different events for the same
 * company (a deal and a CEO change) stay as two stories; a repeat of the same
 * event is collapsed, keeping the higher-magnitude copy.
 */
export function rankItems(
  raw: RawItem[],
  watch: Set<string>,
): { top: PickedStory[]; ranked: PickedStory[] } {
  // Which distinct sources named each ticker — the corroboration signal. Every
  // source counts here, even the ones that never surface a story of their own.
  const sourcesByTicker = new Map<string, Set<NewsSource>>();
  for (const item of raw) {
    if (!item.ticker) continue;
    const set = sourcesByTicker.get(item.ticker) ?? new Set<NewsSource>();
    set.add(item.source);
    sourcesByTicker.set(item.ticker, set);
  }

  // Dedupe per (ticker, confirmed category), keeping the biggest event. Only
  // enriched items are eligible to be surfaced at all.
  const best = new Map<string, RawItem>();
  for (const item of raw) {
    if (!item.enrichment) continue;
    const key = `${item.ticker ?? '?'}:${item.enrichment.category}`;
    const prev = best.get(key);
    if (!prev || item.enrichment.magnitude > (prev.enrichment?.magnitude ?? 0)) {
      best.set(key, item);
    }
  }

  const scored: ScoredItem[] = [];
  for (const item of best.values()) {
    const enrichment = item.enrichment!;
    const sizeTier = sizeTierFor(item.ticker, watch);
    const corroborated = (sourcesByTicker.get(item.ticker ?? '')?.size ?? 0) >= 2;
    const { score, tier } = scoreItem({ category: enrichment.category, sizeTier, corroborated });
    if (!isRankable(tier, score)) continue;
    // Fold in how big the event itself is (a $30bn deal over a routine one),
    // on top of category and company size.
    const finalScore = round(score * (1 + enrichment.magnitude * 0.5));
    scored.push({
      ...item,
      category: enrichment.category,
      company: enrichment.company,
      score: finalScore,
      tier,
      sizeTier,
      headline: enrichment.headline,
      why: enrichment.why,
    });
  }

  scored.sort((a, b) => b.score - a.score || Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const ranked = scored.map(toPicked);
  const top = ranked.slice(0, topCount(ranked.length));
  return { top, ranked };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
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
