/**
 * Shapes for the failed-retest detector.
 *
 * A "level" here is a price that means something — a wall of options open
 * interest, the gamma flip, the day's average price, yesterday's high. The
 * detector watches how price behaves when it crosses one, and names what
 * happened. It never says what will happen next.
 */

/** What kind of price this is, which decides how an event is worded. */
export type LevelKind =
  | 'flip'
  | 'frontFlip'
  | 'ceiling'
  | 'floor'
  | 'vwap'
  | 'priorHigh'
  | 'priorLow';

export interface MonitoredLevel {
  /**
   * Stable across refreshes, so a level keeps its state between runs.
   *
   * Walls are identified by their strike, which does not move. The flip is
   * identified by its kind, because its price is re-solved as the chain
   * updates — see `machine.ts` for what happens when it moves.
   */
  id: string;
  kind: LevelKind;
  /** Current value of the level. */
  price: number;
  /** How this level is named in an event line, e.g. "772 wall". */
  label: string;
}

/** Which way price went through the level. */
export type BreakDirection = 'down' | 'up';

export type EventOutcome =
  /** Price came back, failed to get back in, and was pushed away. */
  | 'failed-retest'
  /** Price came back and closed on its original side. The break did not stick. */
  | 'fake-break'
  /** Price broke and never came back to check. */
  | 'broke-and-left';

export interface RetestEvent {
  id: string;
  levelId: string;
  kind: LevelKind;
  /**
   * The level's value when this event fired, not its value now.
   *
   * The gamma flip is re-solved every time the option chain updates, so a
   * level broken at 09:52 may sit somewhere else by 10:30. Pinning the price
   * here is what stops the feed from silently rewriting its own history.
   */
  levelPrice: number;
  label: string;
  direction: BreakDirection;
  outcome: EventOutcome;
  /** When the level was broken, ISO-8601. */
  brokenAt: string;
  /** When price came back to check it. Null when it never did. */
  retestedAt: string | null;
  /** When the outcome was confirmed — the timestamp the event is filed under. */
  firedAt: string;
  /** New York wall clock of `firedAt`, `HH:MM`, which is what the feed prints. */
  etClock: string;
  /** Whether the breaking bar traded more than the recent average. */
  volumeAboveAverage: boolean;
  /** Breadth reading at the moment it fired, 0-100. Null when none was stored. */
  breadthPct: number | null;
  /**
   * Set when this is a gamma-flip event, which is not just another level.
   *
   * Crossing it changes how every other level behaves, so it is emitted and
   * styled as its own thing rather than as one line among many.
   */
  regime: 'calm' | 'wild' | null;
}

/** Where one level currently stands. Persisted between refreshes. */
export interface LevelState {
  levelId: string;
  /** The level value this state was built against. */
  price: number;
  status: 'holding' | 'broken' | 'retested';
  /** Set once the level is broken. */
  direction: BreakDirection | null;
  brokenAt: string | null;
  /** Volume flag of the breaking bar, carried to whatever event follows. */
  volumeAboveAverage: boolean;
  retestedAt: string | null;
  /**
   * Low (on a downward break) or high (upward) of the bar that retested.
   *
   * The confirmation is that the *next* bar extends past it, so the figure to
   * compare against has to survive to the next bar.
   */
  retestExtreme: number | null;
  /**
   * Whether a first bar has established which side of the level price is on.
   *
   * Until it has, there is no "original side" for a break to be a break from.
   * Without this, the first bar of the session reports every level it happens
   * to sit beyond as having been broken at 09:30 — on a real session that was
   * eight of twenty-two events, all describing the opening print rather than
   * anything price did.
   */
  armed: boolean;
  /**
   * Whether the current break has already produced a confirmed outcome.
   *
   * A break gets named once. Without this, a level that broke and stayed
   * broken re-reports itself every half hour — reset to holding, immediately
   * re-broken because price never came back, timed out again — which describes
   * the clock rather than the market. Observed on a real session: one level
   * produced six identical "broke and left" lines at exact thirty-minute
   * intervals.
   */
  settled: boolean;
  /** Epoch seconds of the last bar folded in, so a refresh never re-reads one. */
  lastBarTime: number;
  /** When this level last produced an event, for the anti-spam cap. */
  lastEventAt: string | null;
}
