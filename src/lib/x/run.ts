import 'server-only';

import { marketSessionRules, snapshotStaleness } from '../events';
import { marketToday } from '../time';
import { readCredentials, postTweet } from './client';
import { buildForSlot, type ComposedPost } from './content';
import { postingEnabledFromValue } from './flags';
import { checkNumbers, checkText } from './guard';
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
    if (!isTradingDay(date, rules)) {
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

  const checks: string[] = [];
  checks.push(...checkText(composed.text));

  const last = await lastSentForSlot(slot.kind).catch(() => null);
  checks.push(...checkNumbers(composed.numbers, last?.numbers ?? null));

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

  // --- send, with a single retry on a transient failure ----------------------

  let result = await postTweet(composed.text);
  if (!result.ok && (result.kind === 'rate' || result.kind === 'other')) {
    result = await postTweet(composed.text);
  }

  if (result.ok) {
    await log({
      at: now.toISOString(),
      date,
      slot: slot.kind,
      slotKey: slot.key,
      text: composed.text,
      length: composed.length,
      outcome: 'sent',
      reason: composed.note,
      tweetId: result.tweetId,
      asOfLabel: composed.asOfLabel,
      numbers: composed.numbers,
    });
    return { ...base, status: 'sent', reason: composed.note, text: composed.text, length: composed.length, tweetId: result.tweetId, asOfLabel: composed.asOfLabel };
  }

  // Auth or billing errors auto-pause: retrying just burns attempts against a
  // problem only a human can fix.
  if (result.kind === 'auth' || result.kind === 'billing') {
    await autoPause(`Auto-paused after an X ${result.kind} error: ${result.error ?? 'unknown'}`);
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
