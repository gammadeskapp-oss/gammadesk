/** One session's reading for a symbol or a sector. */
export interface ScorePoint {
  /** `YYYY-MM-DD` of the session. */
  date: string;
  /** Share of the nine signals voting bullish, 0-100. */
  score: number;
  /** 14-day RSI, for the oversold and overbought flags. */
  rsi: number;
}

export interface SymbolHistory {
  symbol: string;
  /** Oldest first, newest last. */
  points: ScorePoint[];
  /**
   * Weight this member carries in its sector's consensus.
   *
   * 20-session average dollar volume, *not* market cap — see the note on
   * `SectorMomentum.weightBasis`.
   */
  weight: number;
  /** Latest signal counts, for the consensus badge. */
  bullish: number;
  total: number;
}

export type ConsensusLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface SectorConsensus {
  /** Weighted bullish signals, rounded to whole votes for display. */
  bullish: number;
  /** Always the signal count, i.e. 9. */
  total: number;
  label: ConsensusLabel;
  /** Unrounded, so the ordering is not lumpy. */
  exact: number;
  /**
   * How the members were weighted.
   *
   * All-or-nothing per sector: a blend of the two would be incomparable with
   * the sector next to it while looking identical, so one missing cap drops
   * the whole sector to `equal` and the page says so.
   */
  basis: 'market-cap' | 'equal';
  /** Members that forced the fallback, named so the reason is checkable. */
  missingCaps: string[];
}

export type SectorFlag = 'bottoming' | 'topping';

export interface SectorMomentum {
  id: string;
  name: string;
  blurb: string;
  /** Members whose history resolved. */
  members: string[];
  failures: string[];
  /** Sector average score per session, oldest first. */
  series: ScorePoint[];
  /** Latest average score, 0-100. */
  score: number;
  /** Change in that score against 1, 3 and 5 sessions ago. Null when short. */
  delta1: number | null;
  delta3: number | null;
  delta5: number | null;
  /** Lowest and highest sector-average RSI across the stored window. */
  rsiLow: number;
  rsiHigh: number;
  rsiNow: number;
  flag: SectorFlag | null;
  /** Weighted nine-signal consensus across the members. */
  consensus: SectorConsensus;
}

export interface SectorsSnapshot {
  sectors: SectorMomentum[];
  /** `YYYY-MM-DD` of the newest session scored. */
  asOfDate: string;
  computedAt: string;
  /** Sessions of history held per sector. */
  sessions: number;
  notes: string[];
}
