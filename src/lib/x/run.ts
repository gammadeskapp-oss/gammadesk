import 'server-only';

import { marketSessionRules, snapshotStaleness } from '../events';
import { sendAutoPauseAlert } from '../health/email';
import { marketToday } from '../time';
import { readCredentials, postTweet, uploadMedia } from './client';
import { buildForSlot, type ComposedPost } from './content';
import { postingEnabledFromValue } from './flags';
import { checkNumbers, checkText } from './guard';
import { markImagePosted, readImageBytes } from './imageStore';
import { isTradingDay } from './schedule';
import {
  alreadyPosted,
  appendLog,
  autoPause,
  isPaused,
  lastSentForSlot,
} from './store';
import type { PostLogEntry, PostSlot } from './types';

/**
 * Run one slot end to end: compose, self-check, send (retry once), log.
 *
 * The order is deliberate. The cheap, always-fatal gates come first — the env
 * kill switch, the pause switch, the once-a-day ledger — so a disabled or
 * paused poster never so much as reads market data. Then the quality gates that
 * can only be judged from the composed text and figures. Only a post that
 * clears all of them is sent.
 *
 * Nothing here throws: every path returns a `RunOutcome` and writes at most one
 * log line, so a cron calling it can report cleanly whatever happened.
 */

export interface RunOutcome {
  slot: PostSlot['kind'];
  slotKey: string;
  status: 'sent' | 'skipped' | 'failed' | 'preview';
  reason?: string;
  /** Self-check failures, when that is why it was skipped (or on a preview). */
  checks?: string[];
  text?: string;
  length?: number;
  tweetId?: string;
  asOfLabel?: string;
}

export interface RunOptions {
  /** Compose and check, but never post or log. For previews and sample runs. */
  dry?: boolean;
  /** Override the pause switch and the once-a-day ledger. Never the kill switch
   * or the quality checks. */
  force?: boolean;
  now?: Date;
}

/**
 * The env kill switch: posting is off unless X_POSTING_ENABLED is set to a
 * truthy value.
 *
 * Forgiving on purpose, the same way the unlock password is (see
 * `lib/tos/auth.ts`): a value pasted into a Vercel env var routinely arrives
 * wrapped in quotes or with a trailing newline, and "I set it to true but it
 * says disabled" is almost always that. Wrapping quotes and surrounding
 * whitespace are stripped, and the common truthy spellings are accepted, so a
 * correct intent is not defeated by formatting. Anything else — unset, empty,
 * `false`, `0`, `no`, `off` — leaves posting off, which is the safe default.
 */
export function postingEnabled(): boolean {
  return postingEnabledFromValue(process.env['X_POSTING_ENABLED']);
}

/**
 * Owner-facing diagnostic for why posting is or is not enabled. The value is
 * non-sensitive config, and this is only ever surfaced on the owner-only admin
 * page — so it can show the actual value, which is what makes a typo or a
 * stray-quote mistake obvious rather than a silent "disabled".
 */
export function postingEnabledDiagnostic(): {
  enabled: boolean;
  present: boolean;
  rawValue: string | null;
} {
  const raw = process.env['X_POSTING_ENABLED'];
  return {
    enabled: postingEnabled(),
    present: typeof raw === 'string' && raw.length > 0,
    rawValue: typeof raw === 'string' ? raw : null,
  };
}

async function log(entry: PostLogEntry): Promise<void> {
  await appendLog(entry);
}

export async function runSlot(slot: PostSlot, options: RunOptions = {}): Promise<RunOutcome> {
  const now = options.now ?? new Date();
  const dry = options.dry ?? false;
  const force = options.force ?? false;
  const rules = marketSessionRules();
  const date = marketToday(now);

  const base = { slot: slot.kind, slotKey: slot.key } as const;

  // --- cheap, always-fatal gates (skip before touching market data) ----------

  if (!dry) {
    if (!postingEnabled()) {
      return { ...base, status: 'skipped', reason: 'Posting is disabled (X_POSTING_ENABLED is not true).' };
    }
    // The weekly recap fires on a Sunday by design, so it is exempt from the
    // trading-day gate; every other slot requires a live session.
    if (slot.kind !== 'weekly' && !isTradingDay(date, rules)) {
      return { ...base, status: 'skipped', reason: 'Not a trading day (weekend or market holiday).' };
    }
    if (!force && (await isPaused())) {
      return { ...base, status: 'skipped', reason: 'Posting is paused (runtime pause switch is on).' };
    }
    if (!force && (await alreadyPosted(slot.key, date))) {
      return { ...base, status: 'skipped', reason: 'This slot has already posted today.' };
    }
  }

  // --- compose ----------------------------------------------------------------

  let composed: ComposedPost;
  try {
    composed = await buildForSlot(slot.kind, now);
  } catch (error) {
    const reason = `Could not build the post: ${error instanceof Error ? error.message : String(error)}`;
    if (!dry) await log({ at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key, text: '', length: 0, outcome: 'skipped', reason });
    return { ...base, status: 'skipped', reason };
  }

  // --- quality gates (force does not override these) --------------------------

  // The weekly recap and the earnings heads-up are editorial: they carry no
  // "as of" clock (they link to /daily instead), and the earnings post carries
  // no figures at all. Exempt them from the stamp and empty-figure checks — the
  // wording and length rules still apply, as does the jump check on any figure
  // they do carry (the weekly's VIX).
  const editorial = slot.kind === 'weekly' || slot.kind === 'earnings';
  const checks: string[] = [];
  checks.push(...checkText(composed.text, { requireStamp: !editorial }));

  const last = await lastSentForSlot(slot.kind).catch(() => null);
  if (Object.keys(composed.numbers).length > 0 || !editorial) {
    checks.push(...checkNumbers(composed.numbers, last?.numbers ?? null));
  }

  const staleness = snapshotStaleness(composed.dataIso, now);
  if (staleness.stale) {
    checks.push(`Data is stale (${staleness.expectedNote}).`);
  }

  if (checks.length > 0) {
    if (!dry) {
      await log({
        at: now.toISOString(),
        date,
        slot: slot.kind,
        slotKey: slot.key,
        text: composed.text,
        length: composed.length,
        outcome: 'skipped',
        reason: `Self-check failed: ${checks.join(' ')}`,
        asOfLabel: composed.asOfLabel,
        numbers: composed.numbers,
      });
    }
    return { ...base, status: dry ? 'preview' : 'skipped', reason: 'Self-check failed.', checks, text: composed.text, length: composed.length, asOfLabel: composed.asOfLabel };
  }

  // --- preview: everything passed, but do not post ---------------------------

  if (dry) {
    return { ...base, status: 'preview', text: composed.text, length: composed.length, asOfLabel: composed.asOfLabel, checks: [] };
  }

  // --- credentials -----------------------------------------------------------

  if (!readCredentials()) {
    const reason = 'X credentials are not configured.';
    await log({ at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key, text: composed.text, length: composed.length, outcome: 'skipped', reason, asOfLabel: composed.asOfLabel, numbers: composed.numbers });
    return { ...base, status: 'skipped', reason, text: composed.text };
  }

  // --- attach the poster image, when one was supplied ------------------------

  // Morning and closing derive their image from the slot + trading date; weekly
  // and earnings name their own image key (its date is not the trading date), so
  // the composer supplies it. gamma/pulse never carry one.
  const imageRef: { date: string; type: 'morning' | 'closing' | 'weekly' | 'earnings' } | null =
    composed.image ??
    (slot.kind === 'morning' || slot.kind === 'closing' ? { date, type: slot.kind } : null);
  let mediaId: string | undefined;
  let imageNote: string | undefined;
  if (imageRef) {
    const bytes = await readImageBytes(imageRef.date, imageRef.type).catch(() => null);
    if (bytes) {
      const upload = await uploadMedia(bytes);
      if (upload.ok) {
        mediaId = upload.mediaId;
        imageNote = 'with image';
      } else {
        imageNote = 'image upload failed, posted text-only';
      }
    }
  }

  // --- send, with a single retry on a transient failure ----------------------

  // The retry reuses the already-uploaded media id — no re-upload.
  let result = await postTweet(composed.text, mediaId);
  if (!result.ok && (result.kind === 'rate' || result.kind === 'other')) {
    result = await postTweet(composed.text, mediaId);
  }

  // If a tweet carrying an image is rejected for a permission reason, it is the
  // image X is refusing, not the text — the text-only slots (gamma/pulse) post
  // fine with the same credentials. Retry once without the image so the update
  // still goes out, rather than failing the whole post and pausing the poster
  // over an optional poster. (X media upload needs a paid API tier; until then
  // the image simply cannot attach, and text-only is the right graceful result.)
  if (!result.ok && mediaId && result.kind === 'auth') {
    const textOnly = await postTweet(composed.text);
    if (textOnly.ok) {
      result = textOnly;
      imageNote = 'image rejected by X, posted text-only';
      mediaId = undefined; // the image did not post — don't let cleanup retire it.
    }
  }

  if (result.ok) {
    // A posted image is marked so the daily cleanup may later retire it.
    if (mediaId && imageRef) await markImagePosted(imageRef.date, imageRef.type);
    const reason = [composed.note, imageNote].filter(Boolean).join('; ') || undefined;
    await log({
      at: now.toISOString(),
      date,
      slot: slot.kind,
      slotKey: slot.key,
      text: composed.text,
      length: composed.length,
      outcome: 'sent',
      reason,
      tweetId: result.tweetId,
      asOfLabel: composed.asOfLabel,
      numbers: composed.numbers,
    });
    return { ...base, status: 'sent', reason, text: composed.text, length: composed.length, tweetId: result.tweetId, asOfLabel: composed.asOfLabel };
  }

  // A duplicate-content 403 means the identical tweet is already on X. That is
  // not a failure and certainly not a reason to pause the whole poster — record
  // it as a benign skip and move on, so the next slot still runs.
  if (result.kind === 'duplicate') {
    const reason = 'Skipped: X already has an identical post (duplicate content).';
    await log({
      at: now.toISOString(),
      date,
      slot: slot.kind,
      slotKey: slot.key,
      text: composed.text,
      length: composed.length,
      outcome: 'skipped',
      reason,
      asOfLabel: composed.asOfLabel,
      numbers: composed.numbers,
    });
    return { ...base, status: 'skipped', reason, text: composed.text, length: composed.length, asOfLabel: composed.asOfLabel };
  }

  // Auth or billing errors auto-pause: retrying just burns attempts against a
  // problem only a human can fix. Email the owner immediately — a pause
  // silences posting for the rest of the day, and waiting for the nightly
  // health run to surface it is a day too late.
  if (result.kind === 'auth' || result.kind === 'billing') {
    const pauseReason = `Auto-paused after an X ${result.kind} error: ${result.error ?? 'unknown'}`;
    await autoPause(pauseReason);
    // Fire-and-forget: a mail failure must not change the post outcome.
    void sendAutoPauseAlert(pauseReason, now).catch(() => {});
  }

  await log({
    at: now.toISOString(),
    date,
    slot: slot.kind,
    slotKey: slot.key,
    text: composed.text,
    length: composed.length,
    outcome: 'failed',
    reason: result.error ?? 'X post failed.',
    asOfLabel: composed.asOfLabel,
    numbers: composed.numbers,
  });
  return { ...base, status: 'failed', reason: result.error, text: composed.text, length: composed.length };
}
