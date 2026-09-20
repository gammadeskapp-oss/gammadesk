/**
 * Pure view helpers for the public /daily landing page.
 *
 * The page is a server component and cannot be unit-tested directly, so every
 * decision that could go wrong — how a day change is worded and coloured, where
 * each level sits on the little bar visual, what counts as a usable brief
 * highlight — lives here where `scripts/verify-daily.mjs` drives it. The page
 * itself only arranges what these return.
 *
 * The one rule this file keeps: nothing here invents a number or a direction.
 * A missing input yields a dash or an omitted marker, never a guess.
 */

import { formatStrike } from '../format';
import type { Brief } from '../x/text';

/** A signed percent from a fractional change, e.g. 0.0123 -> "+1.2%". */
export function formatChangePct(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  const sign = fraction >= 0 ? '+' : '';
  return `${sign}${(fraction * 100).toFixed(1)}%`;
}

/**
 * The colour tone for a day change, with a small dead-band so a rounding-level
 * move reads as neutral rather than being coloured green or red.
 */
export function changeTone(fraction: number): 'pos' | 'neg' | 'neutral' {
  if (!Number.isFinite(fraction)) return 'neutral';
  if (fraction > 0.0005) return 'pos';
  if (fraction < -0.0005) return 'neg';
  return 'neutral';
}

export interface LevelMarker {
  key: 'floor' | 'flip' | 'spot' | 'ceiling';
  label: string;
  value: number;
  /** Formatted for display, e.g. "610". */
  text: string;
  /** Position along the bar, 0–100 (left to right, low to high price). */
  pct: number;
}

export interface LevelScale {
  markers: LevelMarker[];
  /** True when there is enough to draw the bar (spot plus at least one level). */
  drawable: boolean;
}

const LABELS: Record<LevelMarker['key'], string> = {
  floor: 'Floor',
  flip: 'Balance point',
  spot: 'Now',
  ceiling: 'Ceiling',
};

/**
 * Place the floor, balance point, current price and ceiling on a 0–100 track.
 *
 * The domain is the span of whatever finite values are present, padded a little
 * on each side so the outermost marker is not flush against the edge. When the
 * span collapses (every value equal) the markers stack in the middle rather
 * than dividing by zero.
 */
export function buildLevelScale(input: {
  floor: number | null;
  flip: number | null;
  spot: number | null;
  ceiling: number | null;
}): LevelScale {
  const entries: Array<{ key: LevelMarker['key']; value: number }> = [];
  for (const key of ['floor', 'flip', 'spot', 'ceiling'] as const) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      entries.push({ key, value });
    }
  }

  const hasSpot = entries.some((e) => e.key === 'spot');
  const hasLevel = entries.some((e) => e.key !== 'spot');
  const drawable = hasSpot && hasLevel;

  const values = entries.map((e) => e.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const pad = span > 0 ? span * 0.12 : 1;
  const domainLo = lo - pad;
  const domainHi = hi + pad;
  const width = domainHi - domainLo;

  const markers: LevelMarker[] = entries.map((e) => ({
    key: e.key,
    label: LABELS[e.key],
    value: e.value,
    text: formatStrike(e.value),
    pct: width > 0 ? Math.max(0, Math.min(100, ((e.value - domainLo) / width) * 100)) : 50,
  }));

  return { markers, drawable };
}

export interface DailyHighlights {
  topStory: string | null;
  earnings: string[];
}

/**
 * The public-safe highlights from today's morning brief: the top story and up
 * to three names reporting today. Returns nulls/empties when no brief for the
 * day is available, so the page can hide the section rather than show a stub.
 */
export function dailyHighlights(brief: Brief | null, maxEarnings = 3): DailyHighlights {
  if (!brief) return { topStory: null, earnings: [] };
  const topStory = typeof brief.topStory === 'string' && brief.topStory.trim() ? brief.topStory.trim() : null;
  const earnings = Array.isArray(brief.earningsToday)
    ? brief.earningsToday.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim()).slice(0, maxEarnings)
    : [];
  return { topStory, earnings };
}

/** A calm/wild mood word to a plain heading, kept out of the page so it is testable. */
export function moodHeadline(mood: 'calm' | 'wild'): { word: string; emoji: string } {
  return mood === 'calm' ? { word: 'Calm', emoji: '🟡' } : { word: 'Choppy', emoji: '🔴' };
}
