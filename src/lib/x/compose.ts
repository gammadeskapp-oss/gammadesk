/**
 * Pure composition for the reworked X poster: the fixed morning and closing
 * templates, the intraday fallback line, and every formatting and safety rule
 * that can be judged from text alone.
 *
 * Kept free of `server-only` and of any data fetch so the whole of it is
 * unit-tested directly in `scripts/verify-x-poster.mjs`. `deskData.ts` does the
 * fetching and hands the primitives here; `generate.ts` calls the Claude API for
 * the intraday body and reuses the safety helpers below.
 */

import { formatStrike } from '../format';
import type { PostNumbers } from './types';

export const X_LIMIT = 280;
/** No trailing period — the templates spell it exactly this way. */
export const NFA = 'Not financial advice';
export const DAILY_LINK = 'gammadesk.app/daily';

/** Calm or wild — the plain-English regime the whole poster speaks in. */
export type Mood = 'calm' | 'wild';

/**
 * The one snapshot every post is built from — the same figures the /decision
 * page shows for SPY. Assembled once in `deskData.ts`.
 */
export interface DeskSnapshot {
  /** SPY spot. */
  spot: number;
  /** Fractional day change, e.g. 0.004 = +0.4%. */
  changePct: number;
  dayHigh: number | null;
  dayLow: number | null;
  mood: Mood;
  /** Nearest wall above (resistance), or null. */
  resistance: number | null;
  /** Nearest wall below (support), or null. */
  support: number | null;
  /** Gamma flip level, or null. */
  flip: number | null;
  /** Strongest tracked names, highest score first. */
  strong: ScoredName[];
  /** Weakest tracked names, lowest score first. */
  weak: ScoredName[];
  /** The day's top news headline, one plain line, or null. */
  headline: string | null;
  /** ISO timestamp the SPY figure was read at — the freshness clock. */
  dataIso: string;
}

export interface ScoredName {
  symbol: string;
  score: number;
}

export interface Composed {
  text: string;
  /** X-weighted length (links counted as 23). */
  length: number;
  numbers: PostNumbers;
  dataIso: string;
}

// --- formatting ---------------------------------------------------------------

/** A price to two decimals: 773.4 -> "773.40". */
export function money(n: number): string {
  return n.toFixed(2);
}

/**
 * A signed day change with an arrow, one decimal. Flat reads "0.0%" with no
 * arrow and never "-0.0%". Up is ▲, down is ▼.
 */
export function changeText(fraction: number): string {
  const pct = fraction * 100;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return '0.0%'; // also catches a -0.04% that rounds to -0.0
  const arrow = rounded > 0 ? '▲' : '▼';
  return `${arrow}${Math.abs(rounded).toFixed(1)}%`;
}

/** 🟡 for calm, 🔴 for wild. */
export function moodEmoji(mood: Mood): string {
  return mood === 'calm' ? '🟡' : '🔴';
}

/**
 * A level rounded to a whole number for a post, e.g. 767.54 → "768".
 *
 * The intraday posts quote levels as round numbers on purpose — "the 769
 * ceiling" reads like a person talking, "the 768.54 ceiling" reads like a
 * machine. The chart on /decision keeps the exact strike; only the prose rounds.
 */
export function roundLevel(n: number): string {
  return String(Math.round(n));
}

/**
 * The day change as plain words: "Up 0.3% on the day." / "Down 0.2% on the
 * day." / "Flat on the day." One decimal, and a flat reading never renders as
 * "-0.0%". This is the intraday context line's opener, the spoken cousin of
 * `changeText`'s arrowed form.
 */
export function dayChangeWords(fraction: number): string {
  const rounded = Math.round(fraction * 1000) / 10; // percent, one decimal
  if (rounded === 0) return 'Flat on the day.';
  const dir = rounded > 0 ? 'Up' : 'Down';
  return `${dir} ${Math.abs(rounded).toFixed(1)}% on the day.`;
}

/** A cashtag list: ["META","MU"] -> "$META $MU". */
function cashtags(names: ScoredName[]): string {
  return names.map((n) => `$${n.symbol}`).join(' ');
}

/**
 * A `$SYMBOL` cashtag: a dollar sign, an uppercase letter, then up to five more
 * uppercase letters or a class dot (`$BRK.B`). Deliberately narrow so it never
 * matches a bare dollar amount — no price in any post is written with a leading
 * `$`, but requiring a letter after the sign guarantees it.
 */
const CASHTAG_RE = /\$[A-Z][A-Z.]{0,5}/g;

/** How many `$SYMBOL` cashtags a finished post carries. */
export function countCashtags(text: string): number {
  return (text.match(CASHTAG_RE) ?? []).length;
}

/**
 * X now rejects any post carrying more than one cashtag with HTTP 403
 * ("Posts are limited to a maximum of one cashtag"). Our morning and closing
 * templates name several tickers ($SPY plus the strong/weak lists), and the
 * model-written intraday body can too. Keep the first cashtag — always $SPY at
 * the top of every template — and drop the leading `$` from the rest, so the
 * names still read ("Strong: META MU AVGO") without tripping the limit.
 */
export function limitCashtags(text: string): string {
  let kept = false;
  return text.replace(CASHTAG_RE, (match) => {
    if (!kept) {
      kept = true;
      return match;
    }
    return match.slice(1);
  });
}

/**
 * X counts every link as 23 characters regardless of its literal length, so the
 * 280 budget must weight the gammadesk.app link that way. Everything else is
 * counted by code point.
 */
const LINK_RE = /\bgammadesk\.app(?:\/[^\s]*)?/gi;
export function xLen(text: string): number {
  let count = [...text].length;
  for (const m of text.matchAll(LINK_RE)) {
    count += 23 - [...m[0]].length;
  }
  return count;
}

/**
 * A short plain-English read of where price sits. Deterministic — no model
 * call — so the morning template is fully unit-tested. Mentions the box when
 * both walls are known, else falls back to the mood.
 */
export function plainEnglish(s: DeskSnapshot): string {
  const expect = s.mood === 'wild' ? 'sharp swings' : 'chop';
  if (s.support !== null && s.resistance !== null) {
    return `stuck between ${formatStrike(s.support)}–${formatStrike(s.resistance)}, expect ${expect}.`;
  }
  if (s.resistance !== null) return `watching ${formatStrike(s.resistance)} overhead, expect ${expect}.`;
  if (s.support !== null) return `leaning on ${formatStrike(s.support)} below, expect ${expect}.`;
  return s.mood === 'wild' ? 'moves can feed on themselves today.' : 'moves tend to get absorbed today.';
}

// --- length fitting -----------------------------------------------------------

/**
 * One line, tagged so the fitter knows which are safe to drop and in what
 * order. `news` goes first, then `weak`, exactly as the brief requires.
 */
export interface Line {
  text: string;
  drop?: 'news' | 'weak';
}

/**
 * Join the lines, dropping the optional ones in priority order until the post
 * fits under the X limit: the news line first, then the weak line. Returns the
 * text plus which lines were dropped (for the log note).
 */
export function fit(lines: Line[]): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const render = (ls: Line[]) => ls.map((l) => l.text).join('\n');

  let current = lines;
  if (xLen(render(current)) <= X_LIMIT) return { text: render(current), dropped };

  for (const tag of ['news', 'weak'] as const) {
    if (!current.some((l) => l.drop === tag)) continue;
    current = current.filter((l) => l.drop !== tag);
    dropped.push(tag);
    if (xLen(render(current)) <= X_LIMIT) return { text: render(current), dropped };
  }
  return { text: render(current), dropped };
}

// --- fixed templates ----------------------------------------------------------

/** The 8:30 CT morning post — the exact template from the brief. */
export function composeMorning(s: DeskSnapshot): Composed {
  const lines: Line[] = [];
  lines.push({ text: `$SPY ${money(s.spot)} this morning ${moodEmoji(s.mood)}` });
  lines.push({ text: `Mood: ${s.mood}` });
  if (s.resistance !== null && s.support !== null) {
    lines.push({ text: `Wall above: ${formatStrike(s.resistance)} · Floor below: ${formatStrike(s.support)}` });
  } else if (s.resistance !== null) {
    lines.push({ text: `Wall above: ${formatStrike(s.resistance)}` });
  } else if (s.support !== null) {
    lines.push({ text: `Floor below: ${formatStrike(s.support)}` });
  }
  if (s.flip !== null) {
    lines.push({ text: `Gets wild only under: ${formatStrike(s.flip)}` });
  }
  lines.push({ text: `Plain English: ${plainEnglish(s)}` });
  if (s.strong.length > 0) {
    lines.push({ text: `💪 Strong: ${cashtags(s.strong.slice(0, 3))}` });
  }
  if (s.weak.length > 0) {
    lines.push({ text: `🐢 Weak: ${cashtags(s.weak.slice(0, 2))}`, drop: 'weak' });
  }
  lines.push({ text: NFA });
  lines.push({ text: DAILY_LINK });

  const { text } = fit(lines);
  const capped = limitCashtags(text);
  return { text: capped, length: xLen(capped), numbers: morningNumbers(s), dataIso: s.dataIso };
}

/** The 3:15 CT closing post — the exact template from the brief. */
export function composeClosing(s: DeskSnapshot): Composed {
  const lines: Line[] = [];
  lines.push({ text: `🔔 $SPY closed ${money(s.spot)} (${changeText(s.changePct)})` });
  if (s.flip !== null) {
    const held = s.spot >= s.flip;
    lines.push({ text: `${held ? 'Held above' : 'Closed below'} ${formatStrike(s.flip)} → day read ${s.mood}` });
  } else {
    lines.push({ text: `Day read ${s.mood}` });
  }
  if (s.dayLow !== null && s.dayHigh !== null) {
    lines.push({ text: `Range today: ${money(s.dayLow)}–${money(s.dayHigh)}` });
  }
  const top = s.strong[0];
  const worst = s.weak[0];
  if (top && worst) {
    lines.push({ text: `💪 Top: $${top.symbol} · 🐢 Worst: $${worst.symbol}` });
  } else if (top) {
    lines.push({ text: `💪 Top: $${top.symbol}` });
  }
  if (s.headline) {
    lines.push({ text: `📰 ${s.headline}`, drop: 'news' });
  }
  lines.push({ text: NFA });
  lines.push({ text: DAILY_LINK });

  const { text } = fit(lines);
  const capped = limitCashtags(text);
  return { text: capped, length: xLen(capped), numbers: closingNumbers(s), dataIso: s.dataIso };
}

/**
 * The intraday fallback line, used when the Claude generator fails its own
 * self-checks twice. Deliberately minimal and always safe.
 */
export function composeIntradayFallback(s: DeskSnapshot): Composed {
  const between =
    s.support !== null && s.resistance !== null
      ? ` between ${formatStrike(s.support)} and ${formatStrike(s.resistance)}`
      : '';
  const text = `$SPY at ${money(s.spot)}${between}.\n${NFA}`;
  return { text, length: xLen(text), numbers: { spot: s.spot }, dataIso: s.dataIso };
}

/**
 * Finish an intraday body from the Claude API: trim, guarantee the disclaimer
 * on its own final line, and never a trailing link. The generator is told not
 * to add the disclaimer, so this is the single place it is appended.
 */
export function finishIntraday(body: string, s: DeskSnapshot): Composed {
  let clean = body.trim();
  // Strip a disclaimer the model added anyway, so it is never doubled.
  clean = clean.replace(/\n*not financial advice\.?\s*$/i, '').trim();
  const text = limitCashtags(`${clean}\n${NFA}`);
  return { text, length: xLen(text), numbers: { spot: s.spot }, dataIso: s.dataIso };
}

function morningNumbers(s: DeskSnapshot): PostNumbers {
  const n: PostNumbers = { spot: s.spot };
  if (s.flip !== null) n.flip = s.flip;
  if (s.resistance !== null) n.above = s.resistance;
  if (s.support !== null) n.below = s.support;
  return n;
}

function closingNumbers(s: DeskSnapshot): PostNumbers {
  const n: PostNumbers = { spot: s.spot };
  if (s.flip !== null) n.flip = s.flip;
  return n;
}

// --- safety checks ------------------------------------------------------------

/**
 * Words that must never appear in any post. The brief's list drives the
 * intraday regenerate loop; the fixed templates are written to avoid all of
 * them, so a hit there is a code mistake, not a false alarm.
 */
const BANNED: Array<{ re: RegExp; label: string }> = [
  { re: /\bbuy(?:s|ing)?\b/i, label: 'buy' },
  { re: /\bsell(?:s|ing)?\b/i, label: 'sell' },
  { re: /\btargets?\b/i, label: 'target' },
  { re: /\bguaranteed?\b/i, label: 'guaranteed' },
  { re: /\bdelayed\b/i, label: 'delayed' },
  { re: /\blive\b/i, label: 'live' },
  { re: /\bgamma\b/i, label: 'gamma' },
  { re: /\bGEX\b/i, label: 'GEX' },
  // Jargon the intraday voice must avoid, per the generator's system prompt.
  { re: /\bdealers?\b/i, label: 'dealer' },
  { re: /\bhedg(?:e|es|ing)\b/i, label: 'hedging' },
  { re: /#\w/, label: 'hashtag' },
];

/**
 * Grade finished text against the shared rules: the banned wording, the length
 * limit, the disclaimer, and the "never a *.vercel.app link" rule. Returns
 * every failure so a bad draft names all of its problems at once.
 */
export function checkPost(text: string): string[] {
  const failures: string[] = [];
  if (xLen(text) > X_LIMIT) failures.push(`Too long: ${xLen(text)} of ${X_LIMIT}.`);
  if (!text.includes(NFA)) failures.push(`Missing the "${NFA}" disclaimer.`);
  if (/\bvercel\.app\b/i.test(text)) failures.push('Contains a vercel.app link (must be gammadesk.app).');
  if (countCashtags(text) > 1) failures.push('More than one cashtag ($SYMBOL); X allows only one.');
  for (const { re, label } of BANNED) {
    if (re.test(text)) failures.push(`Contains banned wording (${label}).`);
  }
  return failures;
}

/**
 * The oldest (stalest) of several ISO timestamps — the honest "as of" for a
 * post assembled from more than one feed.
 *
 * The morning/closing posts read the spot and day change from the compact SPY
 * quote but the levels (wall/floor/flip) from the option-chain snapshot. Those
 * two Cboe feeds can freeze independently, so the freshness gate must judge the
 * post by whichever is oldest — otherwise a fresh quote could carry hours-old
 * levels past the 90-minute check (exactly the stale-chain failure the
 * /decision banner catches). Unparseable or missing stamps are ignored; returns
 * null only when nothing valid was given.
 */
export function stalestIso(...isos: Array<string | null | undefined>): string | null {
  let oldest: string | null = null;
  let oldestMs = Infinity;
  for (const iso of isos) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    if (ms < oldestMs) {
      oldestMs = ms;
      oldest = iso;
    }
  }
  return oldest;
}

/** Minutes between an ISO data stamp and `now`; Infinity when unparseable. */
export function ageMinutes(dataIso: string, now: Date = new Date()): number {
  const then = Date.parse(dataIso);
  if (!Number.isFinite(then)) return Infinity;
  return (now.getTime() - then) / 60_000;
}

/** The freshness gate: SPY data older than 90 minutes means skip. */
export const MAX_DATA_AGE_MIN = 90;
