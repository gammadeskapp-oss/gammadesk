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
