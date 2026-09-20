/**
 * Pure post-composition: the words, the assembly, the plain-English mappings.
 *
 * Kept free of `server-only` and of any data fetch so the whole of it can be
 * unit-tested in `scripts/verify-x-poster.mjs`. `content.ts` does the fetching
 * and hands the primitives here; the guard imports the limit and disclaimer
 * from here too, so there is one definition of each.
 */

import { formatStrike } from '../format';
import type { PostNumbers } from './types';

export const X_LIMIT = 280;
export const DISCLAIMER = 'Not financial advice.';
export const LINK = 'gammadesk.app';

export interface ComposedPost {
  slot: 'morning' | 'gamma' | 'pulse' | 'closing';
  text: string;
  length: number;
  numbers: PostNumbers;
  /** Data timestamp ISO for the freshness guard. */
  dataIso: string;
  /** Human "as of" clock, e.g. `10:15 ET`. */
  asOfLabel: string;
}

/** Assemble the final text: body, the "as of" line, then the disclaimer. */
export function assemble(
  bodyLines: string[],
  asOfLabel: string,
  opts: { link?: boolean } = {},
): string {
  const provenance = opts.link ? `as of ${asOfLabel} · ${LINK}` : `as of ${asOfLabel}`;
  return [...bodyLines, provenance, DISCLAIMER].join('\n');
}

/** Plain mood word and its one-line gloss from the dealer-positioning regime. */
export function mood(regime: 'positive' | 'negative'): { word: string; gloss: string; emoji: string } {
  return regime === 'positive'
    ? { word: 'calm', gloss: 'moves tend to get absorbed', emoji: '🟡' }
    : { word: 'choppy', gloss: 'moves can feed on themselves', emoji: '🔴' };
}

export function pct(fraction: number): string {
  const sign = fraction >= 0 ? '+' : '';
  return `${sign}${(fraction * 100).toFixed(1)}%`;
}

/** A plain direction word for a day change, with a small dead-band for "flat". */
export function direction(fraction: number): string {
  if (fraction > 0.001) return 'up';
  if (fraction < -0.001) return 'down';
  return 'flat';
}

// --- The four composers, over already-fetched primitives ---------------------

export interface LevelInput {
  spot: number;
  regime: 'positive' | 'negative';
  flipLevel: number | null;
  wallAbove: number | null;
  floorBelow: number | null;
  /** `10:15 ET` */
  asOfLabel: string;
  dataIso: string;
}

export function composeMorning(input: LevelInput): ComposedPost {
  const m = mood(input.regime);
  const lines = [`SPY at the open ${m.emoji}`];
  if (input.flipLevel !== null) {
    lines.push(
      `Balance point ${formatStrike(input.flipLevel)} — above it tends calmer, below it choppier.`,
    );
  } else {
    lines.push(`Setup looks ${m.word} today — ${m.gloss}.`);
  }
  if (input.wallAbove !== null && input.floorBelow !== null) {
    lines.push(`Watching ${formatStrike(input.floorBelow)} below and ${formatStrike(input.wallAbove)} above.`);
  }

  const numbers: PostNumbers = { spot: input.spot };
  if (input.flipLevel !== null) numbers.flip = input.flipLevel;
  if (input.wallAbove !== null) numbers.above = input.wallAbove;
  if (input.floorBelow !== null) numbers.below = input.floorBelow;

  const text = assemble(lines, input.asOfLabel);
  return { slot: 'morning', text, length: [...text].length, numbers, dataIso: input.dataIso, asOfLabel: input.asOfLabel };
}

export function composeGamma(input: LevelInput): ComposedPost {
  const m = mood(input.regime);
  const lines = [`SPY map for today ${m.emoji}`];
  lines.push(
    input.flipLevel !== null
      ? `Balance point ${formatStrike(input.flipLevel)}: above tends calmer, below tends swingier.`
      : `No clear balance point today.`,
  );
  const above = input.wallAbove !== null ? formatStrike(input.wallAbove) : '—';
  const below = input.floorBelow !== null ? formatStrike(input.floorBelow) : '—';
  lines.push(`Ceiling near ${above} · Floor near ${below}`);
  lines.push(`Mood: ${m.word} (${m.gloss})`);

  const numbers: PostNumbers = { spot: input.spot };
  if (input.flipLevel !== null) numbers.flip = input.flipLevel;
  if (input.wallAbove !== null) numbers.above = input.wallAbove;
  if (input.floorBelow !== null) numbers.below = input.floorBelow;

  const text = assemble(lines, input.asOfLabel, { link: true });
  return { slot: 'gamma', text, length: [...text].length, numbers, dataIso: input.dataIso, asOfLabel: input.asOfLabel };
}

export interface PulseQuote {
  price: number;
  changePct: number;
  quoteIso: string;
}

/**
 * Two to three plain lines on the majors and the volatility gauge. Requires
 * SPY, QQQ and IWM; VIX is optional and never blocks the post.
 */
export function composePulse(
  quotes: { spy?: PulseQuote; qqq?: PulseQuote; iwm?: PulseQuote; vix?: PulseQuote },
  asOfLabel: string,
  dataIso: string,
): ComposedPost {
  const { spy, qqq, iwm, vix } = quotes;
  if (!spy || !qqq || !iwm) {
    throw new Error('Market pulse needs SPY, QQQ and IWM quotes.');
  }

  // Breadth word from the average of the three index ETFs, so "broadly up/down"
  // agrees with the three figures printed on the next line rather than tracking
  // SPY alone (which can diverge from QQQ/IWM on any given hour).
  const avg = (spy.changePct + qqq.changePct + iwm.changePct) / 3;
  const dir = direction(avg);
  const emoji = dir === 'up' ? '🟢' : dir === 'down' ? '🔴' : '⚪';

  const lines = [
    `Market check ${emoji} stocks broadly ${dir}`,
    `SPY ${pct(spy.changePct)} · QQQ ${pct(qqq.changePct)} · IWM ${pct(iwm.changePct)}`,
  ];
  if (vix) {
    const level = vix.price < 20 ? 'low' : vix.price < 30 ? 'elevated' : 'high';
    lines.push(`Volatility gauge ${vix.price.toFixed(1)} (${level})`);
  }

  const numbers: PostNumbers = { spy: spy.price, qqq: qqq.price, iwm: iwm.price };
  if (vix) numbers.vix = vix.price;

  const text = assemble(lines, asOfLabel);
  return { slot: 'pulse', text, length: [...text].length, numbers, dataIso, asOfLabel };
}

export interface ClosingInput extends LevelInput {
  /** SPY day change and price, when the closing quote was available. */
  spyChangePct: number | null;
  spyPrice: number | null;
}

export function composeClosing(input: ClosingInput): ComposedPost {
  const m = mood(input.regime);
  const lines: string[] = [];
  if (input.spyChangePct !== null) {
    lines.push(`SPY closed ${direction(input.spyChangePct)} ${pct(input.spyChangePct)} 🔔`);
  } else {
    lines.push(`SPY into the close 🔔`);
  }
  if (input.flipLevel !== null) {
    const held = input.spot >= input.flipLevel;
    lines.push(
      `${held ? 'Held above' : 'Slipped below'} the balance point ${formatStrike(input.flipLevel)}; day read ${m.word}.`,
    );
  } else {
    lines.push(`Day read ${m.word} — ${m.gloss}.`);
  }

  const numbers: PostNumbers = { spot: input.spot };
  if (input.flipLevel !== null) numbers.flip = input.flipLevel;
  if (input.spyPrice !== null) numbers.spy = input.spyPrice;

  const text = assemble(lines, input.asOfLabel);
  return { slot: 'closing', text, length: [...text].length, numbers, dataIso: input.dataIso, asOfLabel: input.asOfLabel };
}
