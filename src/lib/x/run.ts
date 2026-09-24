import 'server-only';

import { marketSessionRules, snapshotStaleness } from '../events';
import { sendAutoPauseAlert, sendSkipAlert } from '../health/email';
import { marketToday } from '../time';
import { readCredentials, postTweet, uploadMedia } from './client';
import { buildForSlot, type BuildContext, type BuiltPost } from './content';
import { ageMinutes, checkPost, MAX_DATA_AGE_MIN } from './compose';
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
 * The three market slots (morning, intraday, closing) are graded by the shared
 * `checkPost` rules and a 90-minute freshness gate on the SPY data. Weekly and
 * earnings are editorial: no freshness clock, the older wording rules, and a
 * stored poster image when one is present.
 *
 * Nothing here throws: every path returns a `RunOutcome` and writes at most one
 * log line, so a cron calling it can report cleanly whatever happened.
 */

export interface RunOutcome {
  slot: PostSlot['kind'];
  slotKey: string;
  status: 'sent' | 'skipped' | 'failed' | 'preview';
  reason?: string;
  checks?: string[];
  text?: string;
  length?: number;
  tweetId?: string;
  asOfLabel?: string;
  /** For an intraday post: the phrase-bank situation and id. */
  situation?: string;
  phraseId?: string;
}

/** A short wait between transient X retries. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunOptions {
  /** Compose and check, but never post or log. For previews and sample runs. */
  dry?: boolean;
  /** Override the pause switch and the once-a-day ledger. Never the kill switch
   * or the quality checks. */
  force?: boolean;
  now?: Date;
  /** Build context — a pre-loaded snapshot and the day's recent intraday posts. */
  ctx?: BuildContext;
}

/**
 * The env kill switch: posting is off unless X_POSTING_ENABLED is set to a
 * truthy value. Forgiving on formatting, the same way the unlock password is.
 */
export function postingEnabled(): boolean {
  return postingEnabledFromValue(process.env['X_POSTING_ENABLED']);
}

/** Owner-facing diagnostic for why posting is or is not enabled. */
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

/** The self-check failures for a built post, market or editorial. */
function gradePost(built: BuiltPost, last: PostLogEntry | null, now: Date): string[] {
  if (built.editorial) {
    const checks = checkText(built.text, { requireStamp: false });
    if (Object.keys(built.numbers).length > 0) {
      checks.push(...checkNumbers(built.numbers, last?.numbers ?? null));
    }
    const staleness = snapshotStaleness(built.dataIso, now);
    if (staleness.stale) checks.push(`Data is stale (${staleness.expectedNote}).`);
    return checks;
  }

  // Market slot: shared wording/length rules, a figure sanity/jump check, and
  // the 90-minute freshness gate on the SPY data.
  const checks = checkPost(built.text);
  checks.push(...checkNumbers(built.numbers, last?.numbers ?? null));
  const age = ageMinutes(built.dataIso, now);
  if (age > MAX_DATA_AGE_MIN) {
    checks.push(`SPY data is ${Number.isFinite(age) ? `${Math.round(age)} min` : 'of unknown age'} old (limit ${MAX_DATA_AGE_MIN} min).`);
  }
  return checks;
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

  let built: BuiltPost;
  try {
    built = await buildForSlot(slot.kind, now, options.ctx ?? {});
  } catch (error) {
    const reason = `Could not build the post: ${error instanceof Error ? error.message : String(error)}`;
    if (!dry) {
      await log({ at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key, text: '', length: 0, outcome: 'skipped', reason });
      const routineEmpty = slot.kind === 'earnings' && /no earnings names|no morning brief|no well-known/i.test(reason);
      if (!routineEmpty) void sendSkipAlert(slot.kind, reason, now).catch(() => {});
    }
    return { ...base, status: 'skipped', reason };
  }

  // --- quality gates (force does not override these) --------------------------

  const last = await lastSentForSlot(slot.kind).catch(() => null);
  const checks = gradePost(built, last, now);

  if (checks.length > 0) {
    if (!dry) {
      await log({
        at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key,
        text: built.text, length: built.length, outcome: 'skipped',
        reason: `Self-check failed: ${checks.join(' ')}`,
        asOfLabel: built.asOfLabel, numbers: built.numbers, phraseId: built.phraseId,
      });
    }
    return { ...base, status: dry ? 'preview' : 'skipped', reason: 'Self-check failed.', checks, text: built.text, length: built.length, asOfLabel: built.asOfLabel, situation: built.situation, phraseId: built.phraseId };
  }

  // --- preview: everything passed, but do not post ---------------------------

  if (dry) {
    return { ...base, status: 'preview', text: built.text, length: built.length, asOfLabel: built.asOfLabel, checks: [], situation: built.situation, phraseId: built.phraseId };
  }

  // --- credentials -----------------------------------------------------------

  if (!readCredentials()) {
    const reason = 'X credentials are not configured.';
    await log({ at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key, text: built.text, length: built.length, outcome: 'skipped', reason, asOfLabel: built.asOfLabel, numbers: built.numbers });
    return { ...base, status: 'skipped', reason, text: built.text };
  }

  // --- attach the poster image, when one was supplied (editorial only) --------

  let mediaId: string | undefined;
  let imageNote: string | undefined;
  const imageRef = built.image ?? null;
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

  // A temporary X error (rate limit, 5xx, timeout) is retried up to 3 times
  // total with a short wait; auth/billing/duplicate never retry.
  let result = await postTweet(built.text, mediaId);
  for (let attempt = 1; attempt < 3 && !result.ok && (result.kind === 'rate' || result.kind === 'other'); attempt += 1) {
    await delay(800);
    result = await postTweet(built.text, mediaId);
  }

  // A tweet carrying an image that fails for anything but a duplicate: retry
  // once without the image so the update still goes out (X media needs a paid
  // tier; until then text-only is the right graceful result).
  if (!result.ok && mediaId && result.kind !== 'duplicate') {
    const textOnly = await postTweet(built.text);
    if (textOnly.ok) {
      result = textOnly;
      imageNote = 'image rejected by X, posted text-only';
      mediaId = undefined;
    }
  }

  if (result.ok) {
    if (mediaId && imageRef) await markImagePosted(imageRef.date, imageRef.type);
    const reason = [built.note, imageNote].filter(Boolean).join('; ') || undefined;
    await log({
      at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key,
      text: built.text, length: built.length, outcome: 'sent', reason,
      tweetId: result.tweetId, asOfLabel: built.asOfLabel, numbers: built.numbers, phraseId: built.phraseId,
    });
    return { ...base, status: 'sent', reason, text: built.text, length: built.length, tweetId: result.tweetId, asOfLabel: built.asOfLabel, situation: built.situation, phraseId: built.phraseId };
  }

  // Only genuinely bad credentials (`auth`) and out-of-credit (`billing`) pause
  // the poster. Everything else skips this one post and lets later slots run.
  if (result.kind === 'auth' || result.kind === 'billing') {
    const pauseReason = `Auto-paused after an X ${result.kind} error: ${result.error ?? 'unknown'}`;
    await autoPause(pauseReason);
    void sendAutoPauseAlert(pauseReason, now).catch(() => {});
    await log({
      at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key,
      text: built.text, length: built.length, outcome: 'failed',
      reason: result.error ?? 'X post failed.', asOfLabel: built.asOfLabel, numbers: built.numbers,
    });
    return { ...base, status: 'failed', reason: result.error, text: built.text, length: built.length };
  }

  const reason =
    result.kind === 'duplicate'
      ? 'Skipped: X already has an identical post (duplicate content).'
      : `Skipped: ${result.error ?? 'X post failed.'}`;
  await log({
    at: now.toISOString(), date, slot: slot.kind, slotKey: slot.key,
    text: built.text, length: built.length, outcome: 'skipped', reason,
    asOfLabel: built.asOfLabel, numbers: built.numbers,
  });
  void sendSkipAlert(slot.kind, reason, now).catch(() => {});
  return { ...base, status: 'skipped', reason, text: built.text, length: built.length, asOfLabel: built.asOfLabel };
}
