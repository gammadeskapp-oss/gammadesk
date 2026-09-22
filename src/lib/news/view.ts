/**
 * Pure view helpers for the "What's moving" section on /daily and the owner
 * console at /admin/news. The pages are server components and cannot be unit-
 * tested, so every decision that could go wrong — how a timestamp is worded,
 * how a source is labelled, how a story is shortened for a phone — lives here,
 * driven by `scripts/verify-news.mjs`.
 */

import type { NewsSource, PickedStory, Tier } from './types';

/** Short human label for each source, for the little provenance tag. */
export const SOURCE_LABEL: Record<NewsSource, string> = {
  edgar: 'SEC filing',
  polygon: 'News wire',
  press: 'Press release',
};

/** Colour tone for a tier badge on the console. */
export function tierTone(tier: Tier): 'high' | 'medium' | 'low' {
  if (tier === 'high') return 'high';
  if (tier === 'medium') return 'medium';
  return 'low';
}

/**
 * A compact "how long ago" label from an ISO timestamp, relative to `now`.
 * Returns null for a missing or unparseable stamp so the caller can omit it
 * rather than show "NaN".
 */
export function relativeTime(iso: string, now: Date = new Date()): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const mins = Math.round((now.getTime() - then) / 60000);
  if (mins < 0) return 'just now';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * The label shown before a headline: the ticker when we have one, else a short
 * form of the company name. Never empty.
 */
export function storyLabel(story: Pick<PickedStory, 'ticker' | 'company'>): string {
  if (story.ticker) return story.ticker;
  const name = (story.company || '').trim();
  if (!name) return '—';
  return name.length > 28 ? `${name.slice(0, 27).trimEnd()}…` : name;
}

/**
 * Whether the /daily "What's moving" section should render at all. Hidden when
 * there is nothing for the day, so the page shows no empty stub.
 */
export function hasMoving(top: PickedStory[] | null | undefined): boolean {
  return Array.isArray(top) && top.length > 0;
}

/**
 * One-line summary of a story for the morning/closing X post, in the scanner's
 * own words: "KO: raised its full-year guidance". Kept short, with no link (the
 * post carries its own /daily link) and no source words. The company name is
 * dropped from the front so it appears once, next to the ticker.
 */
export function xLine(story: Pick<PickedStory, 'ticker' | 'company' | 'headline'>): string {
  const company = (story.company || '').trim();
  const label = story.ticker ?? company;
  let head = story.headline.trim();
  // The headline leads with the company name; strip it so the ticker carries
  // the subject and the name is not repeated ("Coca-Cola raised…" → "raised…").
  if (company && head.toLowerCase().startsWith(company.toLowerCase())) {
    head = head.slice(company.length).replace(/^['’]s\b/i, '').replace(/^[\s,]+/, '').trim();
  }
  return label && head ? `${label}: ${head}` : story.headline;
}
