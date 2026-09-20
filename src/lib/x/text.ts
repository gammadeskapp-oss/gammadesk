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
/**
 * The gamma post links to the public landing page rather than the app root, so
 * a first-time reader arriving from X lands on the plain-English map that the
 * post is about — not the full dashboard.
 */
export const DAILY_LINK = 'gammadesk.app/daily';

export interface ComposedPost {
  slot: 'morning' | 'gamma' | 'pulse' | 'closing' | 'weekly' | 'earnings';
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
  /**
   * Which stored poster image to try to attach, when this post carries one.
   * The runner reads the bytes for `{date, type}` and posts text-only if none
   * is stored. Morning and closing derive their image from the slot + trading
   * date instead; this is for slots (weekly, earnings) whose image key is not
   * the trading date.
   */
  image?: { date: string; type: 'morning' | 'closing' | 'weekly' | 'earnings' };
}

/** Assemble the final text: body, the "as of" line, then the disclaimer. */
export function assemble(
  bodyLines: string[],
  asOfLabel: string,
  opts: { link?: boolean | string } = {},
): string {
  // `link: true` uses the default site link; a string overrides it with a
  // specific destination (the gamma post points at the /daily landing page).
  const url = typeof opts.link === 'string' ? opts.link : opts.link ? LINK : null;
  const provenance = url ? `as of ${asOfLabel} · ${url}` : `as of ${asOfLabel}`;
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

  const text = assemble(lines, input.asOfLabel, { link: DAILY_LINK });
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

// --- Closing "Closing Bell" brief (Cowork-supplied) --------------------------

/**
 * The daily "Closing Bell" brief, supplied by the Cowork task via
 * POST /api/brief with `type: "closing"`. Untrusted off-platform input, so
 * `validateClosingBrief` is strict.
 *
 * Unlike the morning brief, this carries both the level and the day change for
 * each index: `spy` is the closing price and `spyChangePct` is the day's move in
 * points (e.g. 0.4 = +0.4%). `vix` is the index level.
 */
export interface ClosingBrief {
  type: 'closing';
  date: string;
  spy: number;
  spyChangePct: number;
  qqq: number;
  qqqChangePct: number;
  iwm: number;
  iwmChangePct: number;
  vix: number;
  dayStory: string;
  topMovers: string[];
  receivedAt?: string;
}

/**
 * Validate an incoming closing brief. Pure; returns a cleaned `ClosingBrief` or
 * a reason it was rejected. Never throws.
 */
export function validateClosingBrief(raw: unknown, receivedAt: string): { ok: boolean; brief?: ClosingBrief; error?: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  const b = raw as Record<string, unknown>;

  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return { ok: false, error: 'date must be a YYYY-MM-DD string.' };
  }

  // Levels: strictly positive prices/levels.
  const levels: Record<'spy' | 'qqq' | 'iwm', number> = { spy: 0, qqq: 0, iwm: 0 };
  for (const key of ['spy', 'qqq', 'iwm'] as const) {
    const v = b[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      return { ok: false, error: `${key} must be a positive number (closing level).` };
    }
    levels[key] = v;
  }

  // Day changes: signed percent points, bounded.
  const changes: Record<'spyChangePct' | 'qqqChangePct' | 'iwmChangePct', number> = {
    spyChangePct: 0, qqqChangePct: 0, iwmChangePct: 0,
  };
  for (const key of ['spyChangePct', 'qqqChangePct', 'iwmChangePct'] as const) {
    const v = b[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `${key} must be a finite number (percent change in points).` };
    }
    if (Math.abs(v) > MAX_MOVE_POINTS) {
      return { ok: false, error: `${key} of ${v}% is implausible for a daily move.` };
    }
    changes[key] = v;
  }

  const vix = b.vix;
  if (typeof vix !== 'number' || !Number.isFinite(vix) || vix <= 0 || vix > 200) {
    return { ok: false, error: 'vix must be a number in (0, 200].' };
  }

  if (typeof b.dayStory !== 'string' || b.dayStory.trim().length === 0) {
    return { ok: false, error: 'dayStory must be a non-empty string.' };
  }

  if (!Array.isArray(b.topMovers) || b.topMovers.some((e) => typeof e !== 'string')) {
    return { ok: false, error: 'topMovers must be an array of strings.' };
  }
  const movers = (b.topMovers as string[]).map((e) => e.trim()).filter(Boolean).slice(0, MAX_EARNINGS_STORED);

  return {
    ok: true,
    brief: {
      type: 'closing',
      date: b.date,
      spy: levels.spy,
      spyChangePct: changes.spyChangePct,
      qqq: levels.qqq,
      qqqChangePct: changes.qqqChangePct,
      iwm: levels.iwm,
      iwmChangePct: changes.iwmChangePct,
      vix,
      dayStory: b.dayStory.trim().slice(0, MAX_STORY),
      topMovers: movers,
      receivedAt,
    },
  };
}

/**
 * Compose the closing post from a closing brief.
 *
 * Plain English, under 280, no link. Stamped "as of market close" rather than a
 * clock — the brief describes the finished session, not a moment. The day story
 * is trimmed only as far as needed to fit.
 */
export function composeClosingBrief(brief: ClosingBrief): ComposedPost {
  const marketLine = `SPY ${signedPoints(brief.spyChangePct)} · QQQ ${signedPoints(brief.qqqChangePct)} · IWM ${signedPoints(brief.iwmChangePct)}`;
  const vixLine = `VIX ${brief.vix.toFixed(1)} (${vixWord(brief.vix)})`;
  const movers = brief.topMovers.slice(0, 3);
  const moversLine = movers.length > 0 ? `Top movers: ${movers.join(', ')}` : null;
  const footer = `as of market close · ${DISCLAIMER}`;

  const build = (story: string): string =>
    ['Closing bell 🔔', marketLine, vixLine, story, ...(moversLine ? [moversLine] : []), footer].join('\n');

  let story = brief.dayStory;
  let text = build(story);
  while ([...text].length > X_LIMIT && story.length > 1) {
    const cut = Math.max(1, story.length - ([...text].length - X_LIMIT) - 1);
    story = `${story.slice(0, cut).trimEnd()}…`;
    text = build(story);
  }

  // All four are strictly-positive levels, safe for the jump check; the signed
  // changes were validated at ingestion.
  const numbers: PostNumbers = { spy: brief.spy, qqq: brief.qqq, iwm: brief.iwm, vix: brief.vix };

  return {
    slot: 'closing',
    text,
    length: [...text].length,
    numbers,
    dataIso: brief.receivedAt ?? new Date().toISOString(),
    asOfLabel: 'market close',
  };
}

// --- Weekly "Week in review" brief (Cowork-supplied) -------------------------

/**
 * The Sunday "Week in review" brief, supplied by the Cowork task via
 * POST /api/brief with `type: "weekly"`. Untrusted off-platform input, so
 * `validateWeeklyBrief` is strict.
 *
 * `spyWeekPct` / `qqqWeekPct` / `iwmWeekPct` are the week's percent changes in
 * points (e.g. 1.2 = +1.2%), `vix` is the index level, `weekEnding` is the
 * Friday the week closed on.
 */
export interface WeeklyBrief {
  type: 'weekly';
  /** The Friday the week ended, `YYYY-MM-DD`. */
  weekEnding: string;
  spyWeekPct: number;
  qqqWeekPct: number;
  iwmWeekPct: number;
  vix: number;
  weekStory: string;
  nextWeek: string[];
  receivedAt?: string;
}

/** A weekly index move beyond this many percent is almost certainly bad input. */
const MAX_WEEK_POINTS = 40;

export function validateWeeklyBrief(raw: unknown, receivedAt: string): { ok: boolean; brief?: WeeklyBrief; error?: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  const b = raw as Record<string, unknown>;

  if (typeof b.weekEnding !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.weekEnding)) {
    return { ok: false, error: 'weekEnding must be a YYYY-MM-DD string.' };
  }

  const changes: Record<'spyWeekPct' | 'qqqWeekPct' | 'iwmWeekPct', number> = {
    spyWeekPct: 0, qqqWeekPct: 0, iwmWeekPct: 0,
  };
  for (const key of ['spyWeekPct', 'qqqWeekPct', 'iwmWeekPct'] as const) {
    const v = b[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `${key} must be a finite number (percent change in points).` };
    }
    if (Math.abs(v) > MAX_WEEK_POINTS) {
      return { ok: false, error: `${key} of ${v}% is implausible for a weekly move.` };
    }
    changes[key] = v;
  }

  const vix = b.vix;
  if (typeof vix !== 'number' || !Number.isFinite(vix) || vix <= 0 || vix > 200) {
    return { ok: false, error: 'vix must be a number in (0, 200].' };
  }

  if (typeof b.weekStory !== 'string' || b.weekStory.trim().length === 0) {
    return { ok: false, error: 'weekStory must be a non-empty string.' };
  }

  if (!Array.isArray(b.nextWeek) || b.nextWeek.some((e) => typeof e !== 'string')) {
    return { ok: false, error: 'nextWeek must be an array of strings.' };
  }
  const nextWeek = (b.nextWeek as string[]).map((e) => e.trim()).filter(Boolean).slice(0, MAX_EARNINGS_STORED);

  return {
    ok: true,
    brief: {
      type: 'weekly',
      weekEnding: b.weekEnding,
      spyWeekPct: changes.spyWeekPct,
      qqqWeekPct: changes.qqqWeekPct,
      iwmWeekPct: changes.iwmWeekPct,
      vix,
      weekStory: b.weekStory.trim().slice(0, MAX_STORY),
      nextWeek,
      receivedAt,
    },
  };
}

/**
 * Compose the Sunday weekly-recap post from a weekly brief.
 *
 * Plain English, under 280, links to /daily (no clock stamp — a weekly recap
 * has no "as of" moment). The week story is trimmed only as far as needed.
 */
export function composeWeeklyBrief(brief: WeeklyBrief): ComposedPost {
  const marketLine = `SPY ${signedPoints(brief.spyWeekPct)} · QQQ ${signedPoints(brief.qqqWeekPct)} · IWM ${signedPoints(brief.iwmWeekPct)}`;
  const next = brief.nextWeek.slice(0, 3);
  const nextLine = next.length > 0 ? `Next week: ${next.join(', ')}` : null;
  const footer = `${DAILY_LINK} · ${DISCLAIMER}`;

  const build = (story: string): string =>
    ['Week in review 📅', marketLine, story, ...(nextLine ? [nextLine] : []), footer].join('\n');

  let story = brief.weekStory;
  let text = build(story);
  while ([...text].length > X_LIMIT && story.length > 1) {
    const cut = Math.max(1, story.length - ([...text].length - X_LIMIT) - 1);
    story = `${story.slice(0, cut).trimEnd()}…`;
    text = build(story);
  }

  // VIX is the one strictly-positive figure; the week changes are signed and may
  // be zero or negative, so they are validated at ingestion, not here.
  const numbers: PostNumbers = { vix: brief.vix };

  return {
    slot: 'weekly',
    text,
    length: [...text].length,
    numbers,
    dataIso: brief.receivedAt ?? new Date().toISOString(),
    asOfLabel: `week ending ${brief.weekEnding}`,
    image: { date: brief.weekEnding, type: 'weekly' },
  };
}

// --- Earnings-day post (from the morning brief's earnings list) --------------

/**
 * A curated set of well-known, large companies. The earnings post fires only
 * when at least one of these reports today — a small-cap on the calendar is not
 * something the general market cares about, and this keeps the post to names a
 * non-specialist recognises. Symbols, matched case-insensitively.
 */
export const EARNINGS_MEGACAPS = new Set(
  [
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'BRK.B',
    'JPM', 'V', 'MA', 'LLY', 'WMT', 'XOM', 'UNH', 'ORCL', 'HD', 'COST',
    'NFLX', 'AMD', 'CRM', 'BAC', 'KO', 'PEP', 'ADBE', 'DIS', 'CSCO', 'MCD',
    'ABBV', 'WFC', 'GE', 'CVX', 'INTC', 'QCOM', 'IBM', 'GS', 'NKE', 'PM',
    'TXN', 'CAT', 'BA', 'C', 'PFE', 'T', 'VZ', 'PYPL', 'SBUX', 'MU', 'UBER',
    'BABA', 'F', 'GM', 'DAL', 'JNJ', 'PG', 'MS', 'AXP', 'BLK', 'SCHW',
  ].map((s) => s.toUpperCase()),
);

/**
 * Pull a ticker out of a brief earnings string. Accepts a bare ticker
 * (`AAPL`, `AAPL (after the bell)`) or a name with the ticker in parentheses
 * (`Apple (AAPL)`). Returns the uppercased ticker, or null when none is found.
 */
export function extractTicker(entry: string): string | null {
  const paren = entry.match(/\(([A-Za-z.]{1,6})\)/);
  if (paren && /[A-Za-z]/.test(paren[1])) return paren[1].toUpperCase();
  const lead = entry.trim().match(/^([A-Za-z]{1,5}(?:\.[A-Za-z])?)\b/);
  return lead ? lead[1].toUpperCase() : null;
}

/**
 * From the morning brief's earnings names, keep those that are well-known large
 * companies, de-duplicated by ticker, in order, up to `max`. Each kept entry
 * carries the original display string (so any "before/after the bell" note the
 * brief included is preserved) alongside the ticker.
 */
export function selectEarningsNames(
  entries: string[],
  max = 3,
): Array<{ display: string; ticker: string }> {
  const seen = new Set<string>();
  const out: Array<{ display: string; ticker: string }> = [];
  for (const raw of entries) {
    if (typeof raw !== 'string') continue;
    const display = raw.trim();
    if (!display) continue;
    const ticker = extractTicker(display);
    if (!ticker || !EARNINGS_MEGACAPS.has(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ display, ticker });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Compose the 7:30 CT earnings-day post from the selected names.
 *
 * Plain English, under 280, links to /daily. No predictions, no expected-move
 * numbers, no buy/sell wording — it names who reports and one neutral line on
 * why a heavyweight's report matters to the broad market. Carries no figures;
 * the runner is told to skip the number self-check for this slot.
 */
export function composeEarningsPost(
  names: string[],
  weekdayLabel: string,
  dataIso: string,
  image?: { date: string; type: 'earnings' },
): ComposedPost {
  const namesLine = names.join(' · ');
  const why = 'Reports from companies this large tend to set the tone for the broad market.';
  const footer = `${DAILY_LINK} · ${DISCLAIMER}`;
  const text = ['Earnings today 📊', namesLine, why, footer].join('\n');

  return {
    slot: 'earnings',
    text,
    length: [...text].length,
    // Deliberately no figures — the runner exempts this slot from the "no
    // figures" check rather than inventing a number to satisfy it.
    numbers: {},
    dataIso,
    asOfLabel: weekdayLabel,
    ...(image ? { image } : {}),
  };
}
