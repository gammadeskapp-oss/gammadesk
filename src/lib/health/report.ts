/**
 * Pure shapes and logic for the nightly health check.
 *
 * Everything here is input-only so `scripts/verify-health.mjs` can drive it: how
 * a run is summarised, what the failure email says, which X posts were expected,
 * and how the 30-day history is trimmed. The IO — fetching pages, probing Blob,
 * sending the mail — lives in the server-only siblings and calls into this.
 */

export interface HealthCheck {
  /** Stable id, e.g. `page:home`. */
  id: string;
  /** Human label for the email and the admin console. */
  label: string;
  ok: boolean;
  /** One line saying what was found — always set, pass or fail. */
  detail: string;
}

export interface HealthReport {
  /** Chicago market date the run covers, `YYYY-MM-DD`. */
  date: string;
  /** When the run finished, ISO. */
  ranAt: string;
  total: number;
  failed: number;
  checks: HealthCheck[];
}

/** Roll a set of checks into a report, counting the failures. */
export function toReport(date: string, ranAt: string, checks: HealthCheck[]): HealthReport {
  const failed = checks.filter((c) => !c.ok).length;
  return { date, ranAt, total: checks.length, failed, checks };
}

/** The email subject: names the count, so it reads at a glance in an inbox. */
export function subjectFor(failed: number): string {
  return `GammaDesk: ${failed} check${failed === 1 ? '' : 's'} failed`;
}

/** The plain-text body: the failures first, then the full pass/fail list. */
export function emailBody(report: HealthReport): string {
  const failures = report.checks.filter((c) => !c.ok);
  const lines: string[] = [];
  lines.push(`Nightly health check for ${report.date} — ${report.failed} of ${report.total} checks failed.`);
  lines.push('');
  lines.push('FAILED:');
  for (const c of failures) lines.push(`  ✗ ${c.label} — ${c.detail}`);
  lines.push('');
  lines.push('All checks:');
  for (const c of report.checks) lines.push(`  ${c.ok ? '✓' : '✗'} ${c.label} — ${c.detail}`);
  lines.push('');
  lines.push(`Ran at ${report.ranAt}.`);
  return lines.join('\n');
}

/**
 * Replace any existing entry for the report's date, then keep the most recent
 * `keepDays` reports, newest first. Same-date re-runs overwrite rather than
 * pile up, so a manual re-run does not cost a day of history.
 */
export function trimHistory(history: HealthReport[], report: HealthReport, keepDays = 30): HealthReport[] {
  const others = (Array.isArray(history) ? history : []).filter((r) => r.date !== report.date);
  return [report, ...others].sort((a, b) => b.date.localeCompare(a.date)).slice(0, keepDays);
}

/** A `slot`/`date`/`outcome` row, the subset of the X post log this reads. */
export interface PostRow {
  slot: string;
  date: string;
  outcome: string;
}

/**
 * Were today's expected X posts actually sent?
 *
 * Only meaningful on a trading day with posting switched on — otherwise there is
 * nothing to expect, and the check passes with a reason rather than a red mark.
 * When it does apply, the day's spine is the 8:30 gamma post, the closing post,
 * and at least one market-pulse post; the check names whichever are missing.
 */
export function evaluateExpectedPosts(
  rows: PostRow[],
  date: string,
  opts: { tradingDay: boolean; postingEnabled: boolean },
): { ok: boolean; detail: string } {
  if (!opts.tradingDay) return { ok: true, detail: 'Not a trading day — no posts expected.' };
  if (!opts.postingEnabled) return { ok: true, detail: 'Posting is switched off — no posts expected.' };

  const sentToday = new Set(
    rows.filter((r) => r.date === date && r.outcome === 'sent').map((r) => r.slot),
  );
  const missing: string[] = [];
  if (!sentToday.has('gamma')) missing.push('gamma (8:30)');
  if (!sentToday.has('closing')) missing.push('closing (3:20)');
  if (!sentToday.has('pulse')) missing.push('market pulse');

  return missing.length === 0
    ? { ok: true, detail: 'Gamma, closing and pulse posts all went out today.' }
    : { ok: false, detail: `Expected posts not sent today: ${missing.join(', ')}.` };
}

/** Which env vars must be present, as one check. Returns the missing names. */
export function missingEnv(present: (name: string) => boolean): string[] {
  const required = [
    'X_API_KEY',
    'X_API_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_SECRET',
    'BRIEF_TOKEN',
    'X_POSTING_ENABLED',
  ];
  return required.filter((name) => !present(name));
}
