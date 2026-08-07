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
  magnetAbove: number | null;
  magnetBelow: number | null;
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
