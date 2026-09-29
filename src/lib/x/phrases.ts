/**
 * The intraday phrase bank — a free, offline replacement for the Claude API
 * generator. Each firing builds a human-sounding update:
 *
 *   Line 1  a situational phrase (price + what it's doing) + the day change
 *   Line 2  plain English — what this level/situation actually means
 *   Line 3  the nearest levels: "Next floor: X · Ceiling: Y"
 *   (blank)
 *   "Today's movers:" then a ▲ gainers line and a ▼ losers line, each with %
 *   (blank)
 *   "Not financial advice"
 *
 * aiming for a fuller 200–270 characters rather than a terse one-liner. The
 * movers are TODAY's actual percentage moves (snapshot `gainers`/`losers`), not
 * the multi-day strength score — so "today" is honest. Kept in its own file,
 * free of `server-only`, so it is easy to extend and is unit-tested directly in
 * `scripts/verify-x-poster.mjs`.
 *
 * Placeholders, filled from the desk snapshot: {spot} {sup} {res} {flip}.
 * Levels render as whole numbers.
 */

import {
  NFA,
  X_LIMIT,
  changeText,
  limitCashtags,
  money,
  moverPct,
  roundLevel,
  xLen,
  type Composed,
  type DeskSnapshot,
} from './compose';

export type Situation =
  | 'BELOW_FLIP'
  | 'NEAR_SUPPORT'
  | 'NEAR_RESIST'
  | 'BROKE_UP'
  | 'BROKE_DOWN'
  | 'IN_RANGE';

/** How close to a level counts as "near"/"a cross": 0.15%. */
export const NEAR_PCT = 0.0015;
/** "Right at" a level — inside this, don't call the level one "to watch". */
export const AT_PCT = 0.001;

/** Line-1 phrases per situation. Action-oriented; the range lives on line 2. */
export const PHRASES: Record<Situation, string[]> = {
  IN_RANGE: [
    '$SPY hanging around {spot}, no real direction yet.',
    'Quiet tape so far — $SPY at {spot}, just drifting.',
    '$SPY at {spot}, chopping sideways.',
    'Not much doing. $SPY parked at {spot}.',
    '$SPY grinding along near {spot}, both sides balanced.',
    'Slow session for $SPY, sitting at {spot}.',
    '$SPY at {spot}, still coiled up and going nowhere.',
    'Range-bound $SPY, hovering at {spot}.',
  ],
  NEAR_SUPPORT: [
    '$SPY easing down toward {sup}, now {spot}.',
    'Little dip in $SPY to {spot}, leaning on {sup}.',
    '$SPY pulling back to {spot}, {sup} propping it up so far.',
    '$SPY sliding toward the {sup} floor, {spot} now.',
    'Buyers defending {sup} — $SPY holding {spot}.',
    '$SPY testing the low side near {spot}, {sup} underneath.',
    '$SPY drifting to {spot}, {sup} the floor holding it.',
  ],
  NEAR_RESIST: [
    '$SPY pressing up toward {res}, now {spot}.',
    '$SPY climbing to {spot}, bumping into {res}.',
    '$SPY up near {spot}, {res} capping it so far.',
    'Push higher in $SPY to {spot}, {res} overhead.',
    '$SPY leaning on the {res} ceiling, {spot} now.',
    '$SPY at {spot}, grinding against {res}.',
    'Bid stays firm — $SPY {spot}, knocking on {res}.',
  ],
  BROKE_UP: [
    '$SPY broke through {res}, trading {spot} now.',
    'There it goes — $SPY cleared {res}, up at {spot}.',
    '$SPY popped over {res}, {spot} and climbing.',
    '$SPY through {res} to {spot}, fresh highs for the day.',
    'Ceiling gave — $SPY above {res} at {spot}.',
    '$SPY punched past {res}, now {spot}.',
  ],
  BROKE_DOWN: [
    '$SPY slipped under {sup}, {spot} now.',
    'Floor cracked — $SPY below {sup} at {spot}.',
    '$SPY lost {sup}, trading {spot}.',
    '$SPY broke down through {sup}, {spot} now.',
    '$SPY under {sup} at {spot}, sellers in control for now.',
    'Support gave way — $SPY {spot}, below {sup}.',
  ],
  // Indices 0–2 are neutral; 3–5 use "wild/bigger moves" wording and are held
  // back by the once-an-hour throttle (see WILD_INDICES / `allowWild`).
  BELOW_FLIP: [
    '$SPY under {flip} now at {spot}.',
    '$SPY trading below {flip}, {spot}.',
    '$SPY slipped beneath {flip}, now {spot}.',
    'Heads up — $SPY dropped under {flip} ({spot}). Moves can get bigger from here.',
    '$SPY below {flip} at {spot}. The calm stretch may be over.',
    '$SPY under {flip} now ({spot}) — expect a choppier, wilder tape.',
  ],
};

/**
 * The "wild/bigger moves" phrases per situation — held back to at most once an
 * hour so a whole afternoon under the flip is not a wall of the same warning.
 */
export const WILD_INDICES: Partial<Record<Situation, number[]>> = {
  BELOW_FLIP: [3, 4, 5],
};

/**
 * Used when price is "right at" a near level (within {@link AT_PCT}): instead of
 * calling that level the one to watch — the reader can see price is on it — name
 * the *next* level. Falls back to the ordinary near phrases when the next level
 * is unknown (so nothing renders here).
 */
export const AT_LEVEL: Record<'NEAR_SUPPORT' | 'NEAR_RESIST', string[]> = {
  NEAR_SUPPORT: [
    '$SPY sitting right on {sup} ({spot}). Lose it and {flip} comes into play.',
    '$SPY pinned to {sup} at {spot}; {flip} is the next stop lower.',
  ],
  NEAR_RESIST: [
    '$SPY right at {res} ({spot}). Clear it and it is open air; {sup} back the other way.',
    '$SPY glued to {res} at {spot}; through it the next stop is higher, {sup} below.',
  ],
};

/**
 * Line 2 — the plain-English meaning of the current situation. What a level
 * break or a level test actually implies for the tape, in words a non-specialist
 * reads. Two variants each so followers do not see the identical sentence every
 * time. No banned wording (see `BANNED` in compose.ts).
 */
export const MEANING: Record<Situation, string[]> = {
  BELOW_FLIP: [
    'Below this line moves tend to feed on themselves — expect a wider, choppier tape.',
    'Under here the shock absorbers come off; swings can stretch further than usual.',
  ],
  NEAR_SUPPORT: [
    'This is the floor bulls keep defending; lose it and the slide can pick up speed.',
    'Holding here keeps the day constructive; break it and it opens room lower.',
  ],
  NEAR_RESIST: [
    'This is the ceiling that keeps capping it; clear it and the path opens up.',
    'Getting through here would flip the tape from capped to breaking out.',
  ],
  BROKE_UP: [
    'Clearing that ceiling opens room to run before the next shelf overhead.',
    'With that level behind it, the old ceiling tends to act as a floor now.',
  ],
  BROKE_DOWN: [
    'Losing that floor puts the next levels down in play.',
    'That broken floor tends to cap bounces now — the tape has lower to prove.',
  ],
  IN_RANGE: [
    'Balanced tape — the edges of the range are where the day gets decided.',
    'No edge either way yet; the first clean break of the range sets direction.',
  ],
};

/** The placeholder values available from a snapshot; null when the field is absent. */
function fills(s: DeskSnapshot): Record<string, string | null> {
  return {
    spot: money(s.spot),
    sup: s.support !== null ? roundLevel(s.support) : null,
    res: s.resistance !== null ? roundLevel(s.resistance) : null,
    flip: s.flip !== null ? roundLevel(s.flip) : null,
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
  return /\{[a-z0-9]+\}/i.test(out) ? null : out;
}

/**
 * Decide the situation, in priority order. A cross of the flip or a wall counts
 * only once price is at least {@link NEAR_PCT} (0.15%) past the level — a hair
 * over the line is not a break — while "near" a wall is within that same band.
 * A level that is absent simply cannot match its situations.
 */
export function pickSituation(s: DeskSnapshot): Situation {
  if (s.flip !== null && s.spot < s.flip * (1 - NEAR_PCT)) return 'BELOW_FLIP';
  if (s.support !== null && Math.abs(s.spot - s.support) <= s.support * NEAR_PCT) return 'NEAR_SUPPORT';
  if (s.resistance !== null && Math.abs(s.spot - s.resistance) <= s.resistance * NEAR_PCT) return 'NEAR_RESIST';
  if (s.resistance !== null && s.spot > s.resistance * (1 + NEAR_PCT)) return 'BROKE_UP';
  if (s.support !== null && s.spot < s.support * (1 - NEAR_PCT)) return 'BROKE_DOWN';
  return 'IN_RANGE';
}

/** A stable id for a phrase, so "no reuse today" survives a redeploy. */
export function phraseId(poolKey: string, index: number): string {
  return `${poolKey}#${index}`;
}

/**
 * Line 3 — the nearest levels only, as a floor and a ceiling, never a wide
 * range. `support`/`resistance` are already the nearest walls either side of
 * spot, so this quotes them directly (rounded), e.g. "Next floor: 765 · Ceiling:
 * 770". Returns null when neither wall is known.
 */
function levelsLine(s: DeskSnapshot): string | null {
  const sup = s.support !== null ? roundLevel(s.support) : null;
  const res = s.resistance !== null ? roundLevel(s.resistance) : null;
  if (sup && res) return `Next floor: ${sup} · Ceiling: ${res}`;
  if (res) return `Ceiling: ${res}`;
  if (sup) return `Next floor: ${sup}`;
  return null;
}

/**
 * The "Today's movers" block — a ▲ gainers line and a ▼ losers line, each with
 * the live day change. Tickers are written as `$SYM`; the single-cashtag cap
 * (applied once over the whole post) keeps `$SPY` on line 1 and de-$es these, so
 * "▲ NVDA +2.1% · MSFT +1.4%" is what actually posts. Returns null when no live
 * mover is known (a failed quote fetch), so the block — and the word "today" —
 * simply does not appear rather than showing a stale name.
 */
function moversBlock(s: DeskSnapshot, opts: { max?: number } = {}): string | null {
  const max = opts.max ?? 2;
  const up = s.gainers.slice(0, max);
  const down = s.losers.slice(0, max);
  if (up.length === 0 && down.length === 0) return null;

  const fmt = (m: { symbol: string; changePct: number }) => `$${m.symbol} ${moverPct(m.changePct)}`;
  const lines = ["Today's movers:"];
  if (up.length > 0) lines.push(`▲ ${up.map(fmt).join(' · ')}`);
  if (down.length > 0) lines.push(`▼ ${down.map(fmt).join(' · ')}`);
  return lines.join('\n');
}

export interface IntradayPhrase {
  composed: Composed;
  situation: Situation;
  phraseId: string;
  /** True when the chosen line-1 phrase used "wild/bigger moves" wording. */
  wild: boolean;
}

/** Which line-1 pool to draw from, and whether it carries wild wording. */
function pickLine(
  s: DeskSnapshot,
  situation: Situation,
  values: Record<string, string | null>,
  allowWild: boolean,
): { poolKey: string; templates: string[]; wildIndices: number[] } {
  // "Right at" a near level → name the next level instead of this one.
  if (situation === 'NEAR_SUPPORT' && s.support !== null && Math.abs(s.spot - s.support) <= s.support * AT_PCT) {
    const at = AT_LEVEL.NEAR_SUPPORT;
    if (at.some((t) => render(t, values) !== null)) return { poolKey: 'NEAR_SUPPORT_AT', templates: at, wildIndices: [] };
  }
  if (situation === 'NEAR_RESIST' && s.resistance !== null && Math.abs(s.spot - s.resistance) <= s.resistance * AT_PCT) {
    const at = AT_LEVEL.NEAR_RESIST;
    if (at.some((t) => render(t, values) !== null)) return { poolKey: 'NEAR_RESIST_AT', templates: at, wildIndices: [] };
  }

  const wildIndices = WILD_INDICES[situation] ?? [];
  const templates =
    allowWild || wildIndices.length === 0
      ? PHRASES[situation]
      : PHRASES[situation].map((t, i) => (wildIndices.includes(i) ? null : t)).filter((t): t is string => t !== null);
  // If everything was wild wording (should not happen — every situation keeps
  // neutral lines), fall back to the full set rather than posting nothing.
  return {
    poolKey: situation,
    templates: templates.length > 0 ? templates : PHRASES[situation],
    wildIndices: templates.length > 0 ? wildIndices : [],
  };
}

/**
 * Compose one intraday post from the phrase bank (see the file header for the
 * shape).
 *
 * Line 1 is chosen for the current situation, never a phrase already posted
 * today, preferring the least-used over recent days, with the day change tagged
 * on the end; a "wild/bigger moves" line is only eligible when `allowWild` is
 * set (the caller throttles it to once an hour). Line 2 is the plain-English
 * meaning; line 3 the nearest floor/ceiling; then the "Today's movers" block of
 * live gainers and losers. If the whole thing would exceed the X limit it sheds,
 * in order: the second name on each mover line, the meaning line, the levels
 * line, then the movers block — line 1 plus the disclaimer is the safe floor.
 * Returns null only when the chosen situation has no line-1 phrase that renders
 * from this snapshot — the caller then falls back to the fixed line.
 */
export function composeIntradayPhrase(
  s: DeskSnapshot,
  opts: {
    /** Phrase ids already posted TODAY — never reused while alternatives exist. */
    used?: string[];
    /** Phrase id → times used over the last ~5 days; the selector prefers the
     * least-used, so followers do not see the same lines week to week. */
    usage?: Record<string, number>;
    /** False suppresses "wild/bigger moves" wording (throttled to once an hour). */
    allowWild?: boolean;
    rand?: () => number;
    moverRand?: () => number;
  } = {},
): IntradayPhrase | null {
  const used = opts.used ?? [];
  const usage = opts.usage ?? {};
  const allowWild = opts.allowWild ?? true;
  const rand = opts.rand ?? Math.random;
  const moverRand = opts.moverRand ?? Math.random;
  const values = fills(s);

  const situation = pickSituation(s);
  const { poolKey, templates, wildIndices } = pickLine(s, situation, values, allowWild);

  // Only phrases that render cleanly from this snapshot are candidates.
  const renderable = templates
    .map((template, index) => ({ index, text: render(template, values) }))
    .filter((c): c is { index: number; text: string } => c.text !== null);
  if (renderable.length === 0) return null;

  // Prefer phrases not posted today; if all have been, fall back to the full set.
  const fresh = renderable.filter((c) => !used.includes(phraseId(poolKey, c.index)));
  const candidates = fresh.length > 0 ? fresh : renderable;

  // Among those, prefer the least-used over the recent window, then pick at
  // random within that least-used tier so it still feels natural.
  const count = (c: { index: number }) => usage[phraseId(poolKey, c.index)] ?? 0;
  const min = Math.min(...candidates.map(count));
  const pool = candidates.filter((c) => count(c) === min);
  const chosen = pool[Math.floor(rand() * pool.length) % pool.length];

  // Line 1: the situational phrase with the day change tagged on. Strip the
  // phrase's own trailing period first so it reads "…now 765.20 (▼0.6%)".
  const line1 = `${chosen.text.replace(/\.\s*$/, '')} (${changeText(s.changePct)})`;
  const meanings = MEANING[situation];
  const line2 = meanings[Math.floor(moverRand() * meanings.length) % meanings.length];
  const line3 = levelsLine(s);

  // Assemble the full post, shedding to fit the X limit in priority order.
  const build = (opt: { max: number; meaning: boolean; levels: boolean; movers: boolean }): string => {
    const head = [line1];
    if (opt.meaning) head.push(line2);
    if (opt.levels && line3) head.push(line3);
    const sections = [head.join('\n')];
    const mv = opt.movers ? moversBlock(s, { max: opt.max }) : null;
    if (mv) sections.push(mv);
    return limitCashtags(`${sections.join('\n\n')}\n\n${NFA}`);
  };

  const attempts: Array<{ max: number; meaning: boolean; levels: boolean; movers: boolean }> = [
    { max: 2, meaning: true, levels: true, movers: true },
    { max: 1, meaning: true, levels: true, movers: true },
    { max: 1, meaning: false, levels: true, movers: true },
    { max: 1, meaning: false, levels: false, movers: true },
    { max: 0, meaning: false, levels: false, movers: false },
  ];
  let text = build(attempts[0]);
  for (const attempt of attempts) {
    text = build(attempt);
    if (xLen(text) <= X_LIMIT) break;
  }

  const composed: Composed = { text, length: xLen(text), numbers: { spot: s.spot }, dataIso: s.dataIso };

  return {
    composed,
    situation,
    phraseId: phraseId(poolKey, chosen.index),
    wild: wildIndices.includes(chosen.index),
  };
}
