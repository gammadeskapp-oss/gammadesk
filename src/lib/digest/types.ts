export interface DigestRank {
  symbol: string;
  score: number;
}

/**
 * One day's summary. Deliberately small — everything here has to be readable
 * in about fifteen seconds, so anything that does not change the reader's
 * picture of the day is left out.
 */
export interface Digest {
  /** Trading day in New York, `YYYY-MM-DD`. */
  date: string;
  /** e.g. `Fri 7 Aug 2026`. */
  dateLabel: string;
  generatedAt: string;

  symbol: string;
  spot: number;
  regime: 'positive' | 'negative';
  flipLevel: number | null;
  netGex: number;

  /** Percent of simulated paths closing higher. Null if the forecast failed. */
  odds3d: number | null;
  odds10d: number | null;
  crashPct: number | null;
  riskLabel: string | null;

  leaders: DigestRank[];
  laggards: DigestRank[];

  /** Plain-language sentences, in reading order. */
  lines: string[];
  /** Caveats worth carrying into the summary. */
  notes: string[];
}

export interface StoredDigests {
  entries: Digest[];
}
