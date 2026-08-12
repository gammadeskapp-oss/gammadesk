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
  asOfLabel: string;
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
  conviction: Conviction;
  verdict: Verdict;
  hasOptions: boolean;
  notes: string[];
}
