/**
 * The intraday phrase bank — a free, offline replacement for the Claude API
 * generator. Each firing picks a plain-English line for the current situation,
 * avoiding any phrase already posted today, and half the time adds one mover
 * line. Kept in its own file, free of `server-only`, so it is easy to extend and
 * is unit-tested directly in `scripts/verify-x-poster.mjs`.
 *
 * Placeholders, filled from the desk snapshot: {spot} {sup} {res} {flip}
 * {strong} {weak}. Tickers are always rendered as $cashtags.
 */

import { formatStrike } from '../format';
import { finishIntraday, money, type Composed, type DeskSnapshot } from './compose';

export type Situation =
  | 'BELOW_FLIP'
  | 'NEAR_SUPPORT'
  | 'NEAR_RESIST'
  | 'BROKE_UP'
  | 'BROKE_DOWN'
  | 'IN_RANGE';

/** How close to a level counts as "near" it: 0.15%. */
export const NEAR_PCT = 0.0015;

export const PHRASES: Record<Situation, string[]> = {
  IN_RANGE: [
    '$SPY sitting at {spot}, still stuck between {sup} and {res}. Quiet one so far.',
    "Not much going on. $SPY at {spot}, right in the middle of the {sup}–{res} box.",
    '$SPY drifting around {spot}. Same range as this morning, {sup} to {res}.',
    'Chop day so far. $SPY at {spot}, going nowhere fast.',
    '$SPY at {spot}. Still boxed in between {sup} and {res}, as expected.',
    'Checking in: $SPY {spot}, calm and range-bound.',
    "$SPY hanging out at {spot}. Nothing's broken either way yet.",
    'Slow tape. $SPY at {spot}, still between {sup} and {res}.',
  ],
  NEAR_SUPPORT: [
    "$SPY dipping toward {sup} ({spot} now). That floor's held all day so far.",
    'Little pullback, $SPY at {spot}. Watching to see if {sup} holds again.',
    '$SPY back near the {sup} floor at {spot}. Worth keeping an eye on.',
    '$SPY testing the low end of the range, {spot}. {sup} is the line.',
    'Drifted down to {spot}. $SPY sitting right on top of {sup}.',
  ],
  NEAR_RESIST: [
    "$SPY pushing up toward {res}, now {spot}. That's been the ceiling.",
    "$SPY at {spot}, knocking on {res}. Let's see if it gets through.",
    'Up near the top of the range. $SPY {spot}, {res} just above.',
    '$SPY climbing to {spot}. {res} is the level to watch.',
    'Testing the ceiling again, $SPY {spot} vs {res}.',
  ],
  BROKE_UP: [
    '$SPY broke above {res}, now {spot}. Out of the box to the upside.',
    'There it goes, $SPY through {res}. Sitting at {spot}.',
    '$SPY cleared {res} and is at {spot} now. New territory for today.',
  ],
  BROKE_DOWN: [
    '$SPY slipped under {sup}, now {spot}. Next level to watch is {flip}.',
    'Floor gave way. $SPY at {spot}, below {sup}.',
    '$SPY lost {sup}, trading {spot}. {flip} is the big one below.',
  ],
  BELOW_FLIP: [
    'Heads up: $SPY dropped under {flip} ({spot}). Moves can get bigger from here.',
    '$SPY below {flip} now at {spot}. The calm stretch may be over.',
    '$SPY at {spot}, under {flip}. Expect a choppier, wilder tape.',
  ],
};

export const MOVERS: string[] = [
  '{strong} still leading the pack.',
  '{strong} looking strongest today.',
  '{weak} lagging behind.',
  '{strong} holding up well, {weak} not so much.',
  'Best of the bunch: {strong}.',
];

/** The placeholder values available from a snapshot; null when the field is absent. */
function fills(s: DeskSnapshot): Record<string, string | null> {
  return {
    spot: money(s.spot),
    sup: s.support !== null ? formatStrike(s.support) : null,
    res: s.resistance !== null ? formatStrike(s.resistance) : null,
    flip: s.flip !== null ? formatStrike(s.flip) : null,
    strong: s.strong[0] ? `$${s.strong[0].symbol}` : null,
    weak: s.weak[0] ? `$${s.weak[0].symbol}` : null,
  };
}

/**
 * Fill a template, or return null when it references a value the snapshot does
 * not have (e.g. {sup} on a chain with no support level) — the caller then
 * skips that line rather than posting a stray "{sup}".
 */
export function render(template: string, values: Record<string, string | null>): string | null {
  let out = template;
  for (const key of Object.keys(values)) {
    if (!out.includes(`{${key}}`)) continue;
    const v = values[key];
    if (v === null) return null;
    out = out.split(`{${key}}`).join(v);
  }
  return /\{[a-z]+\}/.test(out) ? null : out;
}

/**
 * Decide the situation, picking the first that matches in the required order.
 * A level that is absent simply cannot match its situations.
 */
export function pickSituation(s: DeskSnapshot): Situation {
  if (s.flip !== null && s.spot < s.flip) return 'BELOW_FLIP';
  if (s.support !== null && Math.abs(s.spot - s.support) <= s.support * NEAR_PCT) return 'NEAR_SUPPORT';
  if (s.resistance !== null && Math.abs(s.spot - s.resistance) <= s.resistance * NEAR_PCT) return 'NEAR_RESIST';
  if (s.resistance !== null && s.spot > s.resistance) return 'BROKE_UP';
  if (s.support !== null && s.spot < s.support) return 'BROKE_DOWN';
  return 'IN_RANGE';
}

/** A stable id for a phrase, so "no reuse today" survives a redeploy. */
export function phraseId(situation: Situation, index: number): string {
  return `${situation}#${index}`;
}

export interface IntradayPhrase {
  composed: Composed;
  situation: Situation;
  phraseId: string;
}

/**
 * Compose one intraday post from the phrase bank.
 *
 * Picks a phrase for the current situation, never one whose id is in `used`
 * (today's already-posted phrases); when every phrase for the situation has been
 * used, it allows a repeat rather than posting nothing. Half the time (by
 * `moverRand`) it appends one renderable mover line. Returns null only when the
 * chosen situation has no phrase that can be fully rendered from this snapshot —
 * the caller then falls back to the fixed line.
 */
export function composeIntradayPhrase(
  s: DeskSnapshot,
  opts: {
    /** Phrase ids already posted TODAY — never reused while alternatives exist. */
    used?: string[];
    /** Phrase id → times used over the last ~5 days; the selector prefers the
     * least-used, so followers do not see the same lines week to week. */
    usage?: Record<string, number>;
    rand?: () => number;
    moverRand?: () => number;
  } = {},
): IntradayPhrase | null {
  const used = opts.used ?? [];
  const usage = opts.usage ?? {};
  const rand = opts.rand ?? Math.random;
  const moverRand = opts.moverRand ?? Math.random;
  const values = fills(s);

  const situation = pickSituation(s);
  const all = PHRASES[situation];

  // Only phrases that render cleanly from this snapshot are candidates.
  const renderable = all
    .map((template, index) => ({ index, text: render(template, values) }))
    .filter((c): c is { index: number; text: string } => c.text !== null);
  if (renderable.length === 0) return null;

  // Prefer phrases not posted today; if all have been, fall back to the full set.
  const fresh = renderable.filter((c) => !used.includes(phraseId(situation, c.index)));
  const candidates = fresh.length > 0 ? fresh : renderable;

  // Among those, prefer the least-used over the recent window, then pick at
  // random within that least-used tier so it still feels natural.
  const count = (c: { index: number }) => usage[phraseId(situation, c.index)] ?? 0;
  const min = Math.min(...candidates.map(count));
  const pool = candidates.filter((c) => count(c) === min);
  const chosen = pool[Math.floor(rand() * pool.length) % pool.length];

  let body = chosen.text;

  // 50% of the time, add one renderable mover line.
  if (moverRand() < 0.5) {
    const movers = MOVERS.map((m) => render(m, values)).filter((m): m is string => m !== null);
    if (movers.length > 0) {
      body = `${body}\n${movers[Math.floor(moverRand() * movers.length) % movers.length]}`;
    }
  }

  return {
    composed: finishIntraday(body, s),
    situation,
    phraseId: phraseId(situation, chosen.index),
  };
}
