/**
 * The stored Trend list — the whole of what this feature persists.
 *
 * Lives in Vercel Blob (see store.ts). Written only by the cron poll; read by
 * the owner-only API. The email subjects and any error text stay on the server
 * — `lastError` is never handed to the browser.
 */
export interface TrendList {
  /** Uppercase, de-duplicated, sorted. */
  symbols: string[];
  /**
   * When each symbol was first seen, ISO 8601, keyed by ticker. Drives the
   * "added N ago" column. A symbol removed and re-added gets a fresh time.
   */
  addedAt: Record<string, string>;
  /** When the list last changed, ISO 8601, or null before the first change. */
  updatedAt: string | null;
  /** When the poll last ran at all — whether or not it changed anything. */
  lastCheckedAt: string | null;
  /**
   * The last poll's error, or null if it succeeded. Server-side only; the
   * public API turns this into a boolean staleness flag and never exposes the
   * text.
   */
  lastError: string | null;
  /**
   * IDs (RFC822 Message-ID, or a uid fallback) of emails already handled.
   *
   * This — not the IMAP \Seen flag — is what makes processing idempotent, so
   * opening or re-reading an alert in Gmail never causes it to be reprocessed
   * or skipped. Bounded to the most recent entries; older alerts fall outside
   * the poll's lookback window and never come back.
   */
  processedIds: string[];
}
