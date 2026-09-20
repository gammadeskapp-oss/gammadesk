/**
 * Ranking the day's filings — pure and unit-tested.
 *
 * The brief's rule is: score by *what kind* of event it is, then weight by *how
 * big the company is* and *how unusual the item is for a company like that*.
 * That is exactly the three factors here:
 *
 *   score = categoryWeight × sizeWeight × unusualness  (+ small keyword nudge)
 *
 * categoryWeight encodes both the tier (High/Medium/Ignore) and, within a tier,
 * how rare and market-moving the item usually is — a bankruptcy outranks a
 * buyback even though both are "High". sizeWeight is the company's size tier.
 * unusualness is highest for the events that almost never happen (bankruptcy,
 * restatement, delisting) and ~1 for the routine ones, so the same category is
 * pushed up when it is genuinely out of the ordinary.
 *
 * Nothing here reads prose, so the ranking can never depend on copyrighted text.
 */

import { CATEGORY_TIER } from './headline';
import type { NewsCategory, Tier } from './types';
import type { SizeTier } from './universe';

/**
 * Category weight — the dominant term. Reuses the same ordering as the headline
 * module's materiality rank so the two never disagree about which of two items
 * in one filing is the story.
 */
const CATEGORY_WEIGHT: Record<NewsCategory, number> = {
  bankruptcy: 100,
  restatement: 95,
  delisting: 90,
  ma: 85,
  regulatory: 80,
  fda: 78,
  guidance: 75,
  leadership: 70,
  buyback: 65,
  deal: 60,
  partnership: 40,
  product: 38,
  insider: 35,
  earnings: 10,
  other: 0,
};

/** How much a company's size lifts or damps a story. */
const SIZE_WEIGHT: Record<SizeTier, number> = {
  mega: 1,
  large: 0.8,
  watch: 0.65,
  other: 0.35,
};

/**
 * How unusual the event is for a public company. The routine cadence items
 * (earnings, most "other" filings) sit at 1; the once-in-a-corporate-lifetime
 * events are lifted well above it so their rarity is part of the score, as the
 * brief asks ("how unusual the item is for that company").
 */
const UNUSUALNESS: Record<NewsCategory, number> = {
  bankruptcy: 1.4,
  restatement: 1.4,
  delisting: 1.35,
  ma: 1.25,
  fda: 1.2,
  regulatory: 1.15,
  guidance: 1.1,
  leadership: 1.1,
  buyback: 1.05,
  deal: 1.05,
  partnership: 1,
  product: 1,
  insider: 1,
  earnings: 1,
  other: 1,
};

/** Keyword tokens that nudge a borderline item, matched case-insensitively. */
const KEYWORD_NUDGE: Array<{ re: RegExp; category: NewsCategory }> = [
  { re: /\b(merger|acqui|takeover|buyout|to acquire|acquires)\b/i, category: 'ma' },
  { re: /\b(bankrupt|chapter 11|chapter 7|insolven)\b/i, category: 'bankruptcy' },
  { re: /\b(delist|listing rule|deficiency)\b/i, category: 'delisting' },
  { re: /\b(guidance|outlook|forecast|cuts|raises|lowers)\b/i, category: 'guidance' },
  { re: /\b(buyback|repurchase|repurchases)\b/i, category: 'buyback' },
  { re: /\b(fda|phase [123]|clinical|approval|trial)\b/i, category: 'fda' },
  { re: /\b(sec charges|doj|antitrust|lawsuit|settlement|probe|investigat)\b/i, category: 'regulatory' },
  { re: /\b(ceo|cfo|chief executive|chief financial|resign|steps down|appoint)\b/i, category: 'leadership' },
  { re: /\b(restat|non-reliance|auditor)\b/i, category: 'restatement' },
  { re: /\b(contract|awarded|deal worth|order)\b/i, category: 'deal' },
  { re: /\b(partner|partnership|collaborat)\b/i, category: 'partnership' },
  { re: /\b(launch|unveil|introduc|new product)\b/i, category: 'product' },
];

/**
 * Classify a free-text title into a category by keyword, for sources that carry
 * no structured item codes (Polygon news, press releases). Returns `other` when
 * nothing recognisable matches, so an unclassifiable headline is treated as
 * boilerplate rather than guessed at.
 *
 * Only the *matched category* is returned — never the source words themselves —
 * so the downstream headline is still generated, never copied.
 */
export function categoryForKeywords(title: string): NewsCategory {
  let best: NewsCategory = 'other';
  let bestWeight = 0;
  for (const { re, category } of KEYWORD_NUDGE) {
    if (re.test(title) && CATEGORY_WEIGHT[category] > bestWeight) {
      best = category;
      bestWeight = CATEGORY_WEIGHT[category];
    }
  }
  return best;
}

export interface ScoreInput {
  category: NewsCategory;
  sizeTier: SizeTier;
  /** Whether a second source independently flagged the same ticker today. */
  corroborated?: boolean;
}

export interface ScoreOutput {
  score: number;
  tier: Tier;
}

/**
 * Score one item. Corroboration by a second source adds a fixed 10% because two
 * independent feeds naming the same company the same day is itself a signal —
 * but it can only lift a story that already has category weight, never turn an
 * `other` into a ranked story.
 */
export function scoreItem(input: ScoreInput): ScoreOutput {
  const base = CATEGORY_WEIGHT[input.category] * SIZE_WEIGHT[input.sizeTier] * UNUSUALNESS[input.category];
  const score = input.corroborated ? base * 1.1 : base;
  return { score: round(score), tier: CATEGORY_TIER[input.category] };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Should this item ever appear in the ranked list at all? Ignore-tier items and
 * anything that scored to zero are dropped — the ranked list the owner sees is
 * "everything that cleared the boilerplate filter", not literally every filing.
 */
export function isRankable(tier: Tier, score: number): boolean {
  return tier !== 'ignore' && score > 0;
}

/**
 * How many stories to surface publicly. The brief asks for 3–5: never fewer
 * than 3 when at least 3 cleared the filter, never more than 5.
 */
export function topCount(available: number): number {
  if (available <= 3) return available;
  return Math.min(5, available);
}
