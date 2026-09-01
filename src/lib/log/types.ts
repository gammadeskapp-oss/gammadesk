/** Whether price stayed on the side of the flip level it started the day on. */
export type FlipOutcome = 'held' | 'broke' | 'na';

/** Which magnet strikes, if any, the day's range reached. */
export type MagnetOutcome = 'none' | 'above' | 'below' | 'both';

/** One trading day's prediction and its settled result. */
export interface LogEntry {
  /** Trading day in New York, `YYYY-MM-DD`. Unique key. */
  date: string;
  /** When the morning snapshot was taken. */
  snapshotAt: string;

  // --- the call, recorded during the session -------------------------------
  regime: 'positive' | 'negative';
  flipLevel: number | null;
  spotAtSnapshot: number;
  /**
   * The LARGEST magnet strike either side, which is not the level the site
   * shows.
   *
   * These two fields are the original accuracy-log measure and the settled
   * outcomes below are judged against them, so they keep their meaning
   * forever. What changed underneath them is the rest of the site: the
   * plain-English view names the *nearest strong* wall (`lib/simple/walls.ts`),
   * which can be a different strike entirely — the whole reason that helper
   * exists is that "biggest" and "nearest" disagreed on the same book.
   */
  magnetAbove: number | null;
  magnetBelow: number | null;
  /**
   * The levels the site actually displays: nearest strong wall each side.
   *
   * Optional because they were added on 2026-08-31 and every entry recorded
   * before that date does not have them. Absent is not the same as null here —
   * null means the chain had no qualifying wall that day, absent means nobody
   * was recording this yet — and the history chart draws them separately for
   * exactly that reason.
   */
  stallLevel?: number | null;
  bounceLevel?: number | null;
  netGex: number;

  // --- the result, recorded after the close --------------------------------
  settled: boolean;
  settledAt?: string;
  /** Where the day's OHLC came from. */
  settledFrom?: 'polygon' | 'cboe';
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  flipOutcome?: FlipOutcome;
  magnetTouched?: MagnetOutcome;
}

export interface AccuracyStats {
  daysTracked: number;
  daysSettled: number;
  /** Days where a flip level existed and could be judged. */
  flipJudged: number;
  flipHeld: number;
  flipHeldPct: number | null;
  /** Days where at least one magnet was recorded. */
  magnetJudged: number;
  magnetTouched: number;
  magnetTouchedPct: number | null;
}

export function summarise(entries: LogEntry[]): AccuracyStats {
  const settled = entries.filter((e) => e.settled);

  const flipJudged = settled.filter(
    (e) => e.flipOutcome === 'held' || e.flipOutcome === 'broke',
  );
  const flipHeld = flipJudged.filter((e) => e.flipOutcome === 'held').length;

  const magnetJudged = settled.filter(
    (e) => e.magnetTouched !== undefined && (e.magnetAbove !== null || e.magnetBelow !== null),
  );
  const magnetTouched = magnetJudged.filter((e) => e.magnetTouched !== 'none').length;

  return {
    daysTracked: entries.length,
    daysSettled: settled.length,
    flipJudged: flipJudged.length,
    flipHeld,
    flipHeldPct: flipJudged.length > 0 ? (flipHeld / flipJudged.length) * 100 : null,
    magnetJudged: magnetJudged.length,
    magnetTouched,
    magnetTouchedPct:
      magnetJudged.length > 0 ? (magnetTouched / magnetJudged.length) * 100 : null,
  };
}

/**
 * Judge one day against the levels recorded that morning.
 *
 * Flip: the snapshot fixes which side of the flip level price was on. The day
 * "held" if the range never reached the other side, and "broke" if it did.
 *
 * Magnets: a magnet counts as touched if the day's range reached that strike.
 *
 * Both use the full session's high and low, including the part of the day
 * BEFORE the snapshot was taken. A daily bar carries no intraday timing, so
 * this slightly over-counts touches and breaks. It is stated in the UI rather
 * than silently assumed.
 */
export function judge(
  entry: Pick<LogEntry, 'flipLevel' | 'spotAtSnapshot' | 'magnetAbove' | 'magnetBelow'>,
  bar: { high: number; low: number },
): { flipOutcome: FlipOutcome; magnetTouched: MagnetOutcome } {
  let flipOutcome: FlipOutcome = 'na';

  if (entry.flipLevel !== null && Number.isFinite(entry.flipLevel)) {
    const flip = entry.flipLevel;
    const startedAbove = entry.spotAtSnapshot >= flip;
    // Held means the range never crossed to the other side of the flip.
    flipOutcome = startedAbove
      ? bar.low >= flip
        ? 'held'
        : 'broke'
      : bar.high <= flip
        ? 'held'
        : 'broke';
  }

  const hitAbove =
    entry.magnetAbove !== null && bar.high >= entry.magnetAbove;
  const hitBelow =
    entry.magnetBelow !== null && bar.low <= entry.magnetBelow;

  const magnetTouched: MagnetOutcome =
    hitAbove && hitBelow ? 'both' : hitAbove ? 'above' : hitBelow ? 'below' : 'none';

  return { flipOutcome, magnetTouched };
}

/**
 * The plain-English verdict on one settled day, for readers who do not want to
 * assemble HELD/BROKE and a magnet outcome into an opinion themselves.
 *
 * `null` means the day cannot be judged at all — nothing settled, or neither a
 * flip level nor a magnet strike was recorded — and that is deliberately not
 * folded into "did not match". An unjudgeable day is not a miss, and counting
 * it as one would flatter or damn the record for no reason.
 */
export type MatchStatus = 'mostly' | 'partially' | 'none';

export const MATCH_LABEL: Record<MatchStatus, string> = {
  mostly: 'Mostly matched',
  partially: 'Partially matched',
  none: 'Did not match',
};

/**
 * Two independent claims are made each morning: that price stays on its side
 * of the flip level, and that the day's range reaches a magnet strike. Both
 * landing is "mostly", one landing is "partially", neither is "did not match".
 *
 * A day where only one of the two could be judged is scored on that one alone
 * rather than being half-credited for a claim that was never made.
 */
export function matchStatus(entry: LogEntry): MatchStatus | null {
  if (!entry.settled) return null;

  const flipJudged = entry.flipOutcome === 'held' || entry.flipOutcome === 'broke';
  const magnetJudged =
    entry.magnetTouched !== undefined &&
    entry.magnetTouched !== null &&
    (entry.magnetAbove !== null || entry.magnetBelow !== null);

  if (!flipJudged && !magnetJudged) return null;

  let hits = 0;
  let claims = 0;
  if (flipJudged) {
    claims += 1;
    if (entry.flipOutcome === 'held') hits += 1;
  }
  if (magnetJudged) {
    claims += 1;
    if (entry.magnetTouched !== 'none') hits += 1;
  }

  if (hits === 0) return 'none';
  if (hits === claims) return 'mostly';
  return 'partially';
}
