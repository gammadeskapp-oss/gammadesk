/**
 * Shared types for the X (Twitter) auto-poster.
 *
 * Kept framework-free so the composition, self-checks and scheduling logic can
 * all be unit-tested directly with `scripts/verify-x-poster.mjs`.
 */

/**
 * The five posting slots. Each maps to one composed message and one row in the
 * "already posted today" ledger.
 *
 * The market pulse fires once an hour through the session, so its slot key
 * carries the Chicago hour — `pulse-09` … `pulse-14` — which is what makes the
 * "not already posted today" guard count six distinct posts rather than one.
 */
export type PostSlotKind = 'morning' | 'gamma' | 'pulse' | 'closing' | 'weekly' | 'earnings';

export interface PostSlot {
  kind: PostSlotKind;
  /** Stable per-day key: `morning`, `gamma`, `pulse-09`, …, `closing`. */
  key: string;
  /** Human label for the admin previews. */
  label: string;
}

/**
 * The numeric fingerprint of a post, kept so the next post in the same slot can
 * be checked for an implausible jump. Only the figures that appear in the text.
 */
export type PostNumbers = Record<string, number>;

/**
 * One line in the durable post log. Written whether the post was sent or
 * skipped, so the admin page and any audit can see exactly what happened and
 * why. Never contains a credential.
 */
export interface PostLogEntry {
  /** ISO timestamp the attempt was made. */
  at: string;
  /** New York trading date the post describes, `YYYY-MM-DD`. */
  date: string;
  slot: PostSlotKind;
  slotKey: string;
  /** The exact text, as composed. Present even when skipped. */
  text: string;
  length: number;
  outcome: 'sent' | 'skipped' | 'failed';
  /** Why it was skipped or failed; the self-check that tripped, or the API error. */
  reason?: string;
  /** X's tweet id when sent. */
  tweetId?: string;
  /** The data timestamp the numbers were read at, e.g. `Sep 19, 2026, 10:15 ET`. */
  asOfLabel?: string;
  /** Figures in the text, for the next post's jump check. */
  numbers?: PostNumbers;
}

/**
 * The runtime pause switch, stored in Blob and toggled from the admin page.
 *
 * Separate from the `X_POSTING_ENABLED` env kill switch: the env var is the
 * deploy-level master off, this is the one a human (or an auth/billing failure)
 * can flip without a redeploy.
 */
export interface PauseState {
  paused: boolean;
  /** Why, and by whom — `owner` from the button, `auto` from an API failure. */
  reason?: string;
  by?: 'owner' | 'auto';
  at?: string;
}

/** The result of trying to send one tweet. */
export interface PostResult {
  ok: boolean;
  tweetId?: string;
  /** HTTP status, when the request completed. */
  status?: number;
  /** Operator-facing detail — never a credential. */
  error?: string;
  /**
   * Classified failure mode, so the caller knows whether to retry, skip, or
   * auto-pause. `auth` and `billing` auto-pause; `rate`/`other` retry once.
   */
  kind?: 'auth' | 'billing' | 'rate' | 'other';
}
