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
  /**
   * An operational note to fold into the log even on a successful post — used
   * to record "brief missing" when the morning post falls back to a live
   * snapshot. Not part of the posted text.
   */
  note?: string;
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

// --- Morning "Desk brief" (Cowork-supplied) ----------------------------------

/**
 * The daily "Morning Desk" brief, supplied by an external Cowork task via
 * POST /api/brief. It is untrusted input from off-platform, so `validateBrief`
 * below is strict and every field is checked before anything is stored or
 * posted.
 *
 * `spy`, `qqq`, `iwm` are percent changes in points (e.g. 0.4 = +0.4%); `vix`
 * is the index level (e.g. 14.8). This is the contract the Cowork task must
 * follow, and it is what the ingestion validator enforces.
 */
export interface Brief {
  /** Market date the brief describes, `YYYY-MM-DD`. */
  date: string;
  spy: number;
  qqq: number;
  iwm: number;
  vix: number;
  topStory: string;
  earningsToday: string[];
  /** Server-set when the brief was received. */
  receivedAt?: string;
}

/** Signed percent from points already in percent (0.4 -> "+0.4%"). */
export function signedPoints(points: number): string {
  const sign = points >= 0 ? '+' : '';
  return `${sign}${points.toFixed(1)}%`;
}

/** Plain calm/choppy word from a VIX level. */
export function vixWord(vix: number): string {
  return vix < 20 ? 'calm' : 'choppy';
}

export interface BriefValidation {
  ok: boolean;
  brief?: Brief;
  error?: string;
}

const MAX_MOVE_POINTS = 25; // a pre-open % move beyond this is almost certainly bad input
const MAX_STORY = 180;
const MAX_EARNINGS_STORED = 25;

/**
 * Validate an incoming brief. Pure, so it is unit-tested directly; returns a
 * cleaned `Brief` (trimmed strings, bounded arrays) or a reason it was rejected.
 * Never throws on malformed input.
 */
export function validateBrief(raw: unknown, receivedAt: string): BriefValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  const b = raw as Record<string, unknown>;

  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return { ok: false, error: 'date must be a YYYY-MM-DD string.' };
  }

  const nums: Array<['spy' | 'qqq' | 'iwm', number]> = [];
  for (const key of ['spy', 'qqq', 'iwm'] as const) {
    const v = b[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `${key} must be a finite number (percent change in points).` };
    }
    if (Math.abs(v) > MAX_MOVE_POINTS) {
      return { ok: false, error: `${key} of ${v}% is implausible for a pre-open move.` };
    }
    nums.push([key, v]);
  }

  const vix = b.vix;
  if (typeof vix !== 'number' || !Number.isFinite(vix) || vix <= 0 || vix > 200) {
    return { ok: false, error: 'vix must be a number in (0, 200].' };
  }

  if (typeof b.topStory !== 'string' || b.topStory.trim().length === 0) {
    return { ok: false, error: 'topStory must be a non-empty string.' };
  }

  if (!Array.isArray(b.earningsToday) || b.earningsToday.some((e) => typeof e !== 'string')) {
    return { ok: false, error: 'earningsToday must be an array of strings.' };
  }
  const earnings = (b.earningsToday as string[])
    .map((e) => e.trim())
    .filter(Boolean)
    .slice(0, MAX_EARNINGS_STORED);

  return {
    ok: true,
    brief: {
      date: b.date,
      spy: nums[0][1],
      qqq: nums[1][1],
      iwm: nums[2][1],
      vix,
      topStory: b.topStory.trim().slice(0, MAX_STORY),
      earningsToday: earnings,
      receivedAt,
    },
  };
}

/**
 * Compose the morning post from a brief.
 *
 * Plain English, under 280, no gamma levels and no link (those belong to the
 * 8:30 post). The top story is trimmed only as far as needed to fit — the fixed
 * lines are short, so it almost never is.
 */
export function composeBriefMorning(brief: Brief, asOfLabel: string): ComposedPost {
  const marketLine = `SPY ${signedPoints(brief.spy)} · QQQ ${signedPoints(brief.qqq)} · VIX ${brief.vix.toFixed(1)} (${vixWord(brief.vix)})`;
  const earnings = brief.earningsToday.slice(0, 3);
  const earningsLine = earnings.length > 0 ? `Earnings today: ${earnings.join(', ')}` : null;
  const footer = `as of ${asOfLabel} · ${DISCLAIMER}`;

  const build = (story: string): string =>
    [
      'Good morning ☕ Before the open:',
      marketLine,
      story,
      ...(earningsLine ? [earningsLine] : []),
      footer,
    ].join('\n');

  let story = brief.topStory;
  let text = build(story);
  // Trim the story if the whole thing overruns, keeping a trailing ellipsis.
  while ([...text].length > X_LIMIT && story.length > 1) {
    const cut = Math.max(1, story.length - ([...text].length - X_LIMIT) - 1);
    story = `${story.slice(0, cut).trimEnd()}…`;
    text = build(story);
  }

  // VIX is the one strictly-positive figure; spy/qqq are signed changes that
  // may legitimately be zero, so they are validated at ingestion, not here.
  const numbers: PostNumbers = { vix: brief.vix };

  return {
    slot: 'morning',
    text,
    length: [...text].length,
    numbers,
    dataIso: brief.receivedAt ?? new Date().toISOString(),
    asOfLabel,
  };
}

/**
 * The fallback morning post when no brief arrived: a simple SPY/QQQ/VIX
 * snapshot from live quotes. Carries the "brief missing" note so the log records
 * why the brief format was not used.
 */
export function composeFallbackMorning(
  quotes: { spy?: PulseQuote; qqq?: PulseQuote; vix?: PulseQuote },
  asOfLabel: string,
  dataIso: string,
): ComposedPost {
  const { spy, qqq, vix } = quotes;
  if (!spy || !qqq || !vix) {
    throw new Error('Fallback morning needs SPY, QQQ and VIX quotes.');
  }
  const marketLine = `SPY ${pct(spy.changePct)} · QQQ ${pct(qqq.changePct)} · VIX ${vix.price.toFixed(1)} (${vixWord(vix.price)})`;
  const text = ['Good morning ☕ Before the open:', marketLine, `as of ${asOfLabel} · ${DISCLAIMER}`].join('\n');

  return {
    slot: 'morning',
    text,
    length: [...text].length,
    numbers: { spy: spy.price, qqq: qqq.price, vix: vix.price },
    dataIso,
    asOfLabel,
    note: 'brief missing',
  };
}
