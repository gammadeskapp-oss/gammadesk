/**
 * Shapes for the swing-only candidate engine on /lab.
 *
 * Client-safe and free of `server-only`: the card grid renders in the browser
 * and reads these labels, so a second hand-written copy would eventually
 * describe a different arrangement from the one the server built. The read path
 * lives in `./index.ts` and the evaluation in `./evaluate.ts`; both are the
 * only places allowed to touch a store or a quote.
 *
 * ## What this engine is, and what it is deliberately not
 *
 * It is an *alignment* read, not a prediction. Every candidate it surfaces is a
 * name where a fixed set of independent checks — market regime, sector, trend,
 * relative strength, a live trigger, volume — all point the same way at once.
 * The score is how many of those agree, shown as ticks. It is never phrased as
 * odds of the trade working, because none of the components measures that and a
 * blend of them does not start to.
 *
 * It reuses the existing engines and rebuilds none of them. Relative strength,
 * the gamma profile, the option-quality grade and the earnings lookup are read
 * exactly as the scanner already stored them; the sector reading is the
 * /sectors consensus and momentum, used as published. The only thing computed
 * fresh on a view is where a *live* price sits against those stored levels —
 * the trigger and the gamma room — which is the whole reason this is not just a
 * filtered scanner table.
 */

/** Which way a candidate is aligned. Never "buy"/"sell" — a direction, not an order. */
export type SwingDirection = 'bullish' | 'bearish';

/**
 * The state of one check.
 *
 * `pass`/`fail` are measured verdicts. `unknown` is neither — nobody could
 * take the reading — and it is kept apart for the same reason every other
 * surface here keeps it apart: a missing reading is not a failing one, and
 * collapsing them lets absent data masquerade as a bearish verdict.
 */
export type SwingCheckState = 'pass' | 'fail' | 'unknown';

/** The mandatory alignment checks, in display order. All must pass to qualify. */
export const SWING_CHECK_KEYS = [
  'market',
  'sector',
  'trend',
  'rs',
  'trigger',
  'volume',
] as const;
export type SwingCheckKey = (typeof SWING_CHECK_KEYS)[number];

export const SWING_CHECK_LABEL: Record<SwingCheckKey, string> = {
  market: 'SPY regime',
  sector: 'Sector strength',
  trend: 'Trend (20/50/200)',
  rs: 'Relative strength',
  trigger: 'Trigger',
  volume: 'Volume vs baseline (recent session ratio)',
};

/**
 * One sentence per check, saying what passing it means. Rendered on the card,
 * not hidden behind a tooltip: a bare "SECTOR ✓" tells a reader who already
 * knows the rules that it fired and everyone else nothing.
 *
 * `sector` is labelled "sector strength" and says so out loud, because the
 * reading is the /sectors consensus and momentum — not a ratio of the stock
 * against SPY, which does not exist here and which this wording must not imply.
 */
export const SWING_CHECK_EXPLANATION: Record<SwingCheckKey, string> = {
  market:
    "SPY's own dealer positioning (gamma) is not in breakdown — not negative. This is SPY's regime alone, not a broad-market composite; QQQ is not read separately here.",
  sector:
    "The name's sector reads strong on the /sectors nine-signal consensus and its momentum agrees. This is sector strength, not the stock measured against SPY.",
  trend: 'Price is above its 20-, 50- and 200-day averages, all three.',
  rs: 'The relative-strength engine ranks it strongly against the rest of the index.',
  trigger:
    'Live price is doing one of three things against stored levels, checked on the current Tradier price: reclaiming the 20-day average, breaking the recent range, or coiled tight and poised at the top of it. The range is measured on daily closes, so these are closing highs and lows, not intraday ones.',
  volume:
    'Recent volume (about the last month) is at or above the name’s own prior baseline. A session ratio, not literally today against a 20-day average — intraday volume is not stored.',
};

/** One check's outcome, with the reading behind it. */
export interface SwingCheck {
  key: SwingCheckKey;
  state: SwingCheckState;
  /** What the number actually was, e.g. `RS 88` or `2.1% above 20 EMA`. */
  detail: string;
}

/**
 * The gamma-room reading: how far the live price sits from the next major
 * modeled level in the trade direction.
 *
 * Shown, never scored into a direction — proximity to a level is information,
 * not a verdict, and the brief is explicit that this engine must not infer one
 * from it. `null` `pct` means no chain was stored for the name, which is a
 * different thing from "no room" and says so.
 */
export interface SwingGammaRoom {
  /** The level the room is measured to (a magnet or the flip), or null. */
  level: number | null;
  /** What the level is, for the card. */
  levelKind: 'magnet' | 'flip' | null;
  /** Signed percent from live price to the level, in the trade direction. */
  pct: number | null;
  /** Why there is no reading, or a caveat on it. Null when the reading is clean. */
  note: string | null;
}

/** The option-quality reading, reused from the scanner's grade. */
export interface SwingOptions {
  /** The scanner's badge, or 'ungraded' when no chain was pulled for this name. */
  badge: 'excellent' | 'tradable' | 'caution' | 'avoid' | 'unknown' | 'ungraded';
  /** Card text — the numbers behind the badge, or the invitation to check. */
  detail: string;
  /** True when implied vol was flagged elevated on the graded contract. */
  elevatedIv: boolean;
}

/** The earnings reading, reused from the stored scan row. */
export interface SwingEarnings {
  /** `clear` = known and outside the holding window; the other two are literal. */
  state: 'clear' | 'inside' | 'unknown';
  detail: string;
}

/** One candidate, as the card renders it. */
export interface SwingCandidate {
  symbol: string;
  direction: SwingDirection;
  sectorName: string | null;

  /** Live price when a quote was had, the stored close otherwise. */
  price: number | null;
  priceSource: 'live' | 'stored';
  /** The stored daily close, kept alongside so the card can show both. */
  storedPrice: number | null;

  /** The six mandatory checks, all `pass` on a qualifying candidate. */
  checks: SwingCheck[];
  /** How many of the six passed. Displayed as the alignment count. */
  passed: number;

  gammaRoom: SwingGammaRoom;
  options: SwingOptions;
  earnings: SwingEarnings;
  /** True when the graded contract's IV was flagged elevated (a caution, never a cut). */
  elevatedIv: boolean;

  /**
   * The level at which the alignment is invalidated — the 20-day average for a
   * bullish name (losing it undoes the reclaim), mirrored for a bearish one.
   * Stated explicitly on every card so the read has a falsifier attached to it.
   */
  invalidationLevel: number | null;
  invalidationNote: string;
}

/**
 * A name the engine looked at and excluded outright, with the one reason that
 * did it. Surfaced rather than silently dropped, so the reader can see the
 * engine is applying its exclusions rather than finding nothing.
 */
export interface SwingExclusion {
  symbol: string;
  direction: SwingDirection;
  reason: string;
}

export interface SwingView {
  bullish: SwingCandidate[];
  bearish: SwingCandidate[];
  /** Hard-excluded names, capped for display, newest reason first. */
  excluded: SwingExclusion[];
  /** New York date of the scan the stored readings came from. */
  scanDate: string | null;
  scannedAt: string | null;
  /** Whether a live overlay was applied, and when. */
  live: { available: boolean; capturedEt: string | null; marketOpen: boolean };
  /** Everything worth telling the reader about coverage and gaps, in plain English. */
  notes: string[];
  /** Data gaps and design decisions the brief asked to be surfaced. */
  caveats: string[];
}

// --- tunables, all stated so the card can name them --------------------------

/**
 * RS score at or above which a name counts as strong for the bullish check.
 *
 * 80 to match the scanner's shipped `rs` filter default, so the two pages
 * cannot call the same name strong and not-strong on the same afternoon. The
 * bearish mirror uses `100 - RS_STRONG`.
 */
export const RS_STRONG = 80;

/**
 * How far past the 20-day average still counts as a live *reclaim* rather than
 * a chase.
 *
 * The same `EXTENDED_PCT` (5%) the scanner already uses for its extended flag,
 * reused so "reclaim" means the same tight band across the site. This governs
 * the reclaim trigger only — the breakout and consolidation triggers can fire
 * further from the 20 EMA, and the "too extended" hard exclusion is a separate,
 * wider bound (`EXTENDED_EXCLUDE_PCT`) so a genuine breakout is not thrown out
 * for having cleared the average by more than a reclaim would.
 */
export const RECLAIM_MAX_PCT = 5;

/**
 * Sessions of stored daily closes the breakout trigger looks back over.
 *
 * A breakout fires when the live price clears the highest close of this window
 * (mirrored to the lowest for a breakdown). Closes, not intraday highs — the
 * bar shards store closing prices, so this is a close-basis range and the card
 * says so.
 */
export const BREAKOUT_LOOKBACK = 20;

/** Sessions the tight-consolidation trigger measures its range over. */
export const CONSOLIDATION_LOOKBACK = 15;

/**
 * How tight the close-basis range has to be to count as a consolidation.
 *
 * `(high − low) / last close` over the lookback, as a percent. Eight percent is
 * a coil for a large-cap over three weeks; the trigger also requires the live
 * price to sit in the upper part of that range (or the lower part, bearish),
 * so a tight range drifting nowhere does not fire it.
 */
export const CONSOLIDATION_MAX_PCT = 8;

/** Where in the range price must sit for the consolidation trigger — top 40%. */
export const CONSOLIDATION_POSITION = 0.6;

/**
 * Above this distance from the 20-day average, a name is hard-excluded as too
 * extended to be starting from — a chase, whatever the trigger says.
 *
 * Wider than the reclaim band on purpose: a breakout or a consolidation break
 * legitimately sits further above the 20 EMA than a reclaim does, and keeping
 * the exclusion at the reclaim band would mean no breakout could ever qualify.
 * Twelve percent is where "strong" tips into "already run".
 */
export const EXTENDED_EXCLUDE_PCT = 12;

/**
 * Below this much room to the next modeled level, a name is hard-excluded for
 * having nowhere to go before it.
 *
 * Only applied when a chain was actually stored for the name — absent gamma is
 * "no reading", never "no room".
 */
export const NO_ROOM_PCT = 1;

/**
 * Calendar days of holding window an upcoming report has to fall inside to
 * hard-exclude the name.
 *
 * Fifteen: a swing hold of a couple of weeks, deliberately wider than the
 * scanner's 10-day contract buffer because the exclusion here is about holding
 * the *stock* through a report, not about one option contract repricing. Only
 * a known-and-inside date excludes; an unknown date is surfaced, never treated
 * as clear.
 */
export const HOLDING_WINDOW_DAYS = 15;
