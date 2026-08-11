export interface MorningPost {
  /** New York date the post describes, `YYYY-MM-DD`. */
  date: string;
  generatedAt: string;
  /** The finished post, exactly as it should be published. */
  text: string;
  /** Character count, so the page can warn before X does. */
  length: number;

  // The pieces, kept so the page can show them without re-deriving anything.
  symbol: string;
  spot: number;
  regime: 'positive' | 'negative';
  mood: 'calm' | 'jumpy';
  flipLevel: number | null;
  wallAbove: number | null;
  floorBelow: number | null;
  plainEnglish: string;
  /** Data timestamp of the chain the numbers came from. */
  asOfLabel: string;
}
