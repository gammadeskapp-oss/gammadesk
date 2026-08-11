import 'server-only';

import { formatStrike } from '../format';
import { getPositioning } from '../positioning';
import { marketToday } from '../time';
import type { MorningPost } from './types';

/**
 * The daily X post.
 *
 * The shape is fixed by hand — six lines, in this order, with these labels.
 * Only the plain-English line is written by the code, and it is the only part
 * that should ever change wording without someone deciding to change it.
 */

/** X's limit. The post is built to sit well inside it. */
export const X_LIMIT = 280;

const FOOTER = '15-min delayed · not advice · gammadesk.app';

/** How close to the flip counts as "sitting on it", as a fraction of spot. */
const ON_THE_LINE = 0.0025;

/**
 * One sentence describing the setup.
 *
 * Ordered most specific first: sitting on the flip is the thing worth saying
 * even when price is also between two walls, because it is the condition most
 * likely to change during the session.
 */
function plainEnglish(args: {
  spot: number;
  regime: 'positive' | 'negative';
  flipLevel: number | null;
  wallAbove: number | null;
  floorBelow: number | null;
}): string {
  const { spot, regime, flipLevel, wallAbove, floorBelow } = args;

  const nearFlip =
    flipLevel !== null && Math.abs(spot - flipLevel) / spot < ON_THE_LINE;

  if (nearFlip) {
    return 'Price is sitting right on the line, so today can change character fast.';
  }

  if (regime === 'negative') {
    return flipLevel === null
      ? 'The padding is off today, so pushes tend to keep going instead of fading.'
      : `Below ${formatStrike(flipLevel)} the padding is off, so moves feed on themselves.`;
  }

  if (wallAbove !== null && floorBelow !== null) {
    return `Boxed between ${formatStrike(floorBelow)} and ${formatStrike(wallAbove)} — expect chop until one gives way.`;
  }

  if (wallAbove !== null) {
    return `Drifts tend to stall into ${formatStrike(wallAbove)} rather than run through it.`;
  }

  return 'Dealers are absorbing moves today, so pushes tend to fade rather than run.';
}

function compose(args: {
  symbol: string;
  mood: 'calm' | 'jumpy';
  wallAbove: number | null;
  floorBelow: number | null;
  flipLevel: number | null;
  plain: string;
}): string {
  const { symbol, mood, wallAbove, floorBelow, flipLevel, plain } = args;
  const dash = '—';
  const strike = (v: number | null) => (v === null ? dash : formatStrike(v));

  return [
    `$${symbol} this morning ${mood === 'calm' ? '🟡' : '🔴'}`,
    `Mood: ${mood}`,
    `Wall above: ${strike(wallAbove)} · Floor below: ${strike(floorBelow)}`,
    `Gets wild only under: ${flipLevel === null ? dash : formatStrike(flipLevel)}`,
    `Plain English: ${plain}`,
    FOOTER,
  ].join('\n');
}

export async function buildMorningPost(): Promise<MorningPost> {
  const data = await getPositioning();
  const { summary } = data;

  const regime = summary.regime;
  const mood = regime === 'positive' ? 'calm' : 'jumpy';
  const wallAbove = summary.magnetAbove?.strike ?? null;
  const floorBelow = summary.magnetBelow?.strike ?? null;

  const plain = plainEnglish({
    spot: summary.spot,
    regime,
    flipLevel: summary.flipLevel,
    wallAbove,
    floorBelow,
  });

  const text = compose({
    symbol: data.symbol,
    mood,
    wallAbove,
    floorBelow,
    flipLevel: summary.flipLevel,
    plain,
  });

  return {
    date: marketToday(),
    generatedAt: new Date().toISOString(),
    text,
    // Counted in code points, not UTF-16 units, so the emoji counts as one.
    length: [...text].length,
    symbol: data.symbol,
    spot: summary.spot,
    regime,
    mood,
    flipLevel: summary.flipLevel,
    wallAbove,
    floorBelow,
    plainEnglish: plain,
    asOfLabel: data.meta.asOfLabel,
  };
}

/**
 * The Discord version.
 *
 * Wrapped in a code fence so the channel shows exactly the characters that go
 * to X — no Markdown eating the `·`, and one tap to copy on mobile.
 */
export function toDiscordMessage(post: MorningPost): string {
  return [`**Morning post — ${post.date}**`, '```', post.text, '```'].join('\n');
}
