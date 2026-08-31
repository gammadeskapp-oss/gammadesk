import 'server-only';

import { formatStrike } from '../format';
import { getPositioning } from '../positioning';
import { marketToday } from '../time';
import { regimeLabel, type Regime } from '../regime';
import type { Digest } from '../digest/types';
import type { MorningPost } from './types';

/**
 * The daily X post.
 *
 * The shape is fixed by hand — six lines, in this order, with these labels.
 * Only the "What this means" line is written by the code, and it is the only part
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
  regime: Regime;
  mood: 'calm' | 'jumpy';
  wallAbove: number | null;
  floorBelow: number | null;
  flipLevel: number | null;
  plain: string;
}): string {
  const { symbol, regime, mood, wallAbove, floorBelow, flipLevel, plain } = args;
  const dash = '—';
  const strike = (v: number | null) => (v === null ? dash : formatStrike(v));

  return [
    `$${symbol} this morning ${mood === 'calm' ? '🟡' : '🔴'}`,
    // The same words the site uses. A reader who arrives here from a post
    // should not meet a third vocabulary for the state they just read about.
    `Mood: ${regimeLabel(regime)}`,
    `Wall above: ${strike(wallAbove)} · Floor below: ${strike(floorBelow)}`,
    `Gets wild only under: ${flipLevel === null ? dash : formatStrike(flipLevel)}`,
    `What this means: ${plain}`,
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
    regime,
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

/** `2026-08-14` -> `Fri 14 Aug`, matching the digest's header style. */
function headerDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(parsed);
}

/**
 * The Discord version, formatted like the daily digest.
 *
 * Written for someone reading the channel: bold values, one idea per line, the
 * same shape the digest uses so the two daily messages look like they come
 * from the same place.
 *
 * It used to carry a second half — the post verbatim in a code fence under a
 * "Copy for X:" heading — so a reader could copy it to X unchanged. That was
 * removed deliberately. The consequence is worth stating plainly: the six-line
 * post text no longer reaches Discord at all, and the only place to copy it
 * from is the Copy button on /daily.
 */
export function toDiscordMessage(
  post: MorningPost,
  /**
   * The day's digest, folded in below the headline.
   *
   * Optional on purpose: the morning run fires hours before the digest job,
   * so this is built live from already-cached sources and can fail. When it
   * does the post still goes out — a headline with no narrative beats no
   * message at all.
   */
  digest?: Digest | null,
): string {
  const dash = '—';
  const strike = (v: number | null) => (v === null ? dash : formatStrike(v));
  /*
   * Same words as every screen, through the same helper — the Discord message
   * and the site were the two places most likely to drift apart, because
   * nobody reads them side by side.
   */
  const emoji = post.mood === 'calm' ? '🟡' : '🔴';
  const mood = `${emoji} **${regimeLabel(post.regime)}**`;

  const lines = [
    `**GammaDesk morning post ${dash} ${headerDate(post.date)}**`,
    `$${post.symbol} **${post.spot.toFixed(2)}** · mood ${mood}`,
    `Wall above **${strike(post.wallAbove)}** · Floor below **${strike(post.floorBelow)}**`,
    `Gets wild only under **${strike(post.flipLevel)}**`,
    `What this means: ${post.plainEnglish}`,
  ];

  if (digest && digest.lines.length > 0) {
    // Blank line between each: Discord collapses single newlines, and these
    // are paragraphs rather than a list.
    lines.push('', ...digest.lines.flatMap((line) => [line, '']));
    lines.pop();
  }

  for (const note of digest?.notes ?? []) lines.push(`⚠ ${note}`);

  lines.push(`_15-min delayed · not advice · gammadesk.app_`);

  return lines.join('\n');
}
