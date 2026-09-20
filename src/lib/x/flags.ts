/**
 * Pure parsing of the X_POSTING_ENABLED kill switch, split out of `run.ts` (which
 * is server-only) so it can be unit-tested directly.
 *
 * Forgiving on purpose, the same way the unlock password is (see
 * `lib/tos/auth.ts`): a value pasted into a Vercel env var routinely arrives
 * wrapped in quotes or with a trailing newline, and "I set it to true but it
 * says disabled" is almost always that. Wrapping quotes and surrounding
 * whitespace are stripped and the common truthy spellings are accepted, so a
 * correct intent is not defeated by formatting. Anything else — unset, empty,
 * `false`, `0`, `no`, `off` — leaves posting off, the safe default.
 */

const TRUTHY = new Set(['true', '1', 'yes', 'on', 'enabled']);

export function normaliseFlag(raw: string | undefined | null): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase();
}

export function postingEnabledFromValue(raw: string | undefined | null): boolean {
  return TRUTHY.has(normaliseFlag(raw));
}
