/**
 * Shared types for the news scanner.
 *
 * Kept free of any `server-only` import and of value imports that pull one, so
 * the pure scoring/headline/view/schedule modules that depend on these types
 * can be unit-tested directly under Node by `scripts/verify-news.mjs`.
 */

/** The three sources the scanner reads, in order of trust. */
export type NewsSource = 'edgar' | 'polygon' | 'press';

/** The plain-English category a raw item is classified into. */
export type NewsCategory =
  | 'ma' // mergers, acquisitions, definitive agreements
  | 'deal' // major contracts / commercial deals
  | 'guidance' // guidance raised or cut
  | 'bankruptcy'
  | 'delisting'
  | 'leadership' // CEO/CFO departure or appointment
  | 'buyback'
  | 'regulatory' // regulatory action, investigations, consent
  | 'fda' // FDA / clinical decision
  | 'restatement' // non-reliance / restatement / auditor change
  | 'product' // new product / launch
  | 'partnership'
  | 'insider' // large insider transaction
  | 'earnings' // routine results
  | 'other'; // uncategorised / boilerplate

/** Where a category sits in the brief's High / Medium / Ignore buckets. */
export type Tier = 'high' | 'medium' | 'ignore';

/**
 * A single candidate story, after a source-specific adapter has normalised the
 * raw feed row into a common shape. `headline` and `why` are always the
 * scanner's own plain-English words — never text copied from the source.
 */
export interface RawItem {
  source: NewsSource;
  /** Uppercase ticker when known, else null (some filers have no listed symbol). */
  ticker: string | null;
  /** Issuer name as published by the source (used for display only). */
  company: string;
  category: NewsCategory;
  /** ISO timestamp the item was filed / published. */
  timestamp: string;
  /** Canonical link back to the original source document. */
  url: string;
  /**
   * The structured signals the scorer reads. Free of prose so scoring can never
   * accidentally depend on copyrighted source text.
   */
  signals: {
    /** 8-K item codes, e.g. ["1.01", "5.02"]. Empty for non-EDGAR items. */
    itemCodes?: string[];
    /** Lower-cased keyword tokens matched in a title/description, if any. */
    keywords?: string[];
  };
}

/** A raw item after scoring, ready to rank. */
export interface ScoredItem extends RawItem {
  score: number;
  tier: Tier;
  /** The size tier of the company, driving the size weight. */
  sizeTier: 'mega' | 'large' | 'watch' | 'other';
  /** One-line, plain-English headline in the scanner's own words. */
  headline: string;
  /** One line on why it matters, in the scanner's own words. */
  why: string;
}

/** The compact record stored per day and shown on /daily. */
export interface PickedStory {
  ticker: string | null;
  company: string;
  headline: string;
  why: string;
  url: string;
  timestamp: string;
  source: NewsSource;
  category: NewsCategory;
  score: number;
}

/** One completed scan, stored append-friendly under its market date. */
export interface NewsScanResult {
  /** Market date, `YYYY-MM-DD` (America/New_York). */
  date: string;
  /** When this scan ran, ISO. */
  scannedAt: string;
  /** The day's top 3–5, already ranked. */
  top: PickedStory[];
  /** The full ranked list, for the owner console (what got filtered out). */
  ranked: PickedStory[];
  /** Per-source outcome, so a failed source is visible, never silent. */
  sources: SourceReport[];
}

export interface SourceReport {
  source: NewsSource;
  ok: boolean;
  /** How many candidates this source contributed. */
  count: number;
  /** Present only when the source failed or was skipped. */
  note?: string;
}
