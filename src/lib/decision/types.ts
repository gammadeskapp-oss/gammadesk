import type { LevelMap } from './levelMap';
import type { Liquidity } from '../ticker/types';

export type Grade = 'green' | 'amber' | 'red';

export interface Wall {
  strike: number;
  /** Dollar gamma at the strike. Sign carries the dealer positioning. */
  gex: number;
  /** Share of the largest wall on the same side, 0-1. */
  strength: number;
  distancePct: number;
}

export interface DecisionContext {
  symbol: string;
  spot: number;
  regime: 'positive' | 'negative';
  /** Plain word for the regime, used throughout the page. */
  mood: 'calm' | 'wild';
  flipLevel: number | null;
  aboveFlip: boolean | null;
  flipDistancePct: number | null;
  magnetAbove: Wall | null;
  magnetBelow: Wall | null;
  /**
   * When this page rendered. Not when the book was read.
   *
   * Kept because the morning post stamps itself with it, and only for that.
   * Nothing describing the *levels* may use it: it moves with the wall clock,
   * so a book that has not been rewritten for two days still reports the
   * current minute, and the reader is told the numbers are current by the one
   * line whose job was to say how old they are.
   */
  asOfLabel: string;
  /**
   * When the chain this decision was built from was stamped by the feed.
   *
   * This is the age of the book on screen, and it is what every surface that
   * dates the levels must print — see the note on `asOfLabel` above.
   */
  quoteDateLabel: string;
  /**
   * The quote date of the chain this decision was built from, as an ISO
   * timestamp.
   *
   * Carried alongside the human label rather than derived from it: the label
   * is formatted for reading and cannot be parsed back reliably, and the
   * staleness guard needs a real instant to compare against the session clock.
   */
  quoteDateIso: string;
}

export interface Check {
  id: 'freshness' | 'distance' | 'speed';
  label: string;
  grade: Grade;
  /** The measured answer, e.g. "1st touch". */
  value: string;
  /** One line saying what was measured and how it was graded. */
  detail: string;
}

export interface Conviction {
  checks: Check[];
  /** Level the checks were measured against. */
  level: number | null;
  /** Which side of spot that level sits. */
  side: 'above' | 'below' | null;
  /** True when there were no intraday bars to measure. */
  unavailable: boolean;
  note?: string;
}

export interface Verdict {
  /** The one plain-English line. */
  line: string;
  /** Set when the reads disagree, so the page can say so. */
  conflict: string | null;
  tone: Grade;
}

export interface DecisionResult {
  context: DecisionContext;
  walls: { above: Wall[]; below: Wall[] };
  /**
   * The same levels arranged as one ladder, for the level map view.
   *
   * Always built — the toggle between the two views is a client-side switch,
   * so both have to be present in the payload the server sends.
   */
  levelMap: LevelMap;
  conviction: Conviction;
  verdict: Verdict;
  hasOptions: boolean;
  /**
   * Tradeability for this name — null when its bars could not be read.
   *
   * Lives on the result rather than being fetched by the page because it
   * gates what the page is allowed to show: below the open-interest floor the
   * exposure figures are suppressed, so the same object that renders the
   * panel decides that.
   */
  liquidity: Liquidity | null;
  notes: string[];
}

/**
 * Whether the dollar exposure figures may be shown at all.
 *
 * One helper, used by every consumer, so the exposure tables and the walls
 * can never disagree about whether the chain is deep enough to trust. A
 * missing assessment is treated as permissive: the tradeability lookup
 * failing is not evidence that open interest is thin, and blanking a working
 * SPY page because a secondary fetch timed out would be its own kind of lie.
 */
export function exposureIsReliable(liquidity: Liquidity | null): boolean {
  if (liquidity === null) return true;
  return liquidity.options.exposureReliable;
}
