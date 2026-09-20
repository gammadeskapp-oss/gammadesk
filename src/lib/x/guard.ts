/**
 * The self-checks every post must clear before it is sent. A failure here means
 * the slot is skipped and the reason logged — never a post that breaks a rule.
 *
 * The text and number checks are pure functions over their inputs, so they are
 * exhaustively unit-tested in `scripts/verify-x-poster.mjs`. The IO-bound checks
 * (freshness, pause, already-posted, the env kill switch) are composed in
 * `run.ts`, which has the store and the clock.
 */

import { DISCLAIMER, X_LIMIT } from './text';
import type { PostNumbers } from './types';

/**
 * Wording that must never appear: buy/sell language, trade calls, and the two
 * banned provenance words ("delayed", "live"). Kept deliberately broad on the
 * trade-call side — the copy is written to avoid all of it, so a match means a
 * mistake, not a false alarm.
 */
const BANNED: Array<{ re: RegExp; label: string }> = [
  { re: /\b(buy|buys|buying|bought)\b/i, label: 'buy' },
  { re: /\b(sell|sells|selling|sold)\b/i, label: 'sell' },
  { re: /\b(go|going)\s+(long|short)\b/i, label: 'go long/short' },
  { re: /\b(short|shorting)\s+(it|this|here|the|now)\b/i, label: 'short call' },
  { re: /\b(long)\s+(here|now|the)\b/i, label: 'long call' },
  { re: /\b(trade|trades|trading|traders?)\b/i, label: 'trade' },
  { re: /\b(calls?|puts?)\b/i, label: 'calls/puts' },
  { re: /\b(entry|entries|exit|exits|stop[- ]?loss|take[- ]?profit|price target)\b/i, label: 'entry/exit/target' },
  { re: /\bdelayed\b/i, label: '"delayed"' },
  { re: /\blive\b/i, label: '"live"' },
];

/**
 * Grade the finished text against the wording rules.
 *
 * Returns every failure so a bad draft names all of its problems at once rather
 * than one per run.
 */
export function checkText(text: string): string[] {
  const failures: string[] = [];
  const length = [...text].length;

  if (length > X_LIMIT) {
    failures.push(`Too long: ${length} of ${X_LIMIT} characters.`);
  }
  if (!text.includes(DISCLAIMER)) {
    failures.push(`Missing the "${DISCLAIMER}" disclaimer.`);
  }
  if (!/\bas of\b/i.test(text) || !/\bET\b/.test(text)) {
    failures.push('Missing the "as of … ET" data time.');
  }
  for (const { re, label } of BANNED) {
    if (re.test(text)) failures.push(`Contains banned wording (${label}).`);
  }
  return failures;
}

/** Per-key ceiling on how far a figure may move from the last post before it is
 * treated as implausible. VIX genuinely swings, so it is held to a loose bound;
 * everything price-like uses the default. */
const JUMP_LIMIT: Record<string, number> = { vix: 1.0 };
const DEFAULT_JUMP_LIMIT = 0.25;

/**
 * Grade the figures: none may be zero, negative, or non-finite, and none may
 * have jumped more than its limit versus the last post in the same slot.
 *
 * `last` is null on the first post of a slot, or after a gap — a missing
 * baseline is not itself a failure, it just skips the jump comparison.
 */
export function checkNumbers(numbers: PostNumbers, last: PostNumbers | null): string[] {
  const failures: string[] = [];

  const keys = Object.keys(numbers);
  if (keys.length === 0) {
    failures.push('No figures to sanity-check.');
    return failures;
  }

  for (const key of keys) {
    const value = numbers[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      failures.push(`Figure "${key}" is not a sane positive number (${value}).`);
      continue;
    }
    if (last && typeof last[key] === 'number' && last[key] > 0) {
      const change = Math.abs(value / last[key] - 1);
      const limit = JUMP_LIMIT[key] ?? DEFAULT_JUMP_LIMIT;
      if (change > limit) {
        failures.push(
          `Figure "${key}" jumped ${(change * 100).toFixed(0)}% vs the last post (limit ${(limit * 100).toFixed(0)}%).`,
        );
      }
    }
  }
  return failures;
}
