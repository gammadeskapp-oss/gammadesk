/**
 * The autonomous tick's pure decision logic.
 *
 * One cron wakes the poster every 5 minutes across the trading day; each wake
 * calls `nextAction` to decide, from the Chicago clock and what has already been
 * done today, whether to post the morning template, an intraday update, the
 * closing template, send the daily summary, wait (data stale — retry next tick),
 * or do nothing. Kept pure and free of `server-only` so every branch is
 * unit-tested in `scripts/verify-x-poster.mjs`.
 *
 * The self-healing, self-reporting helpers here — auto-resume from a pause, the
 * day summary, the consecutive-skip alarm — are pure over their inputs for the
 * same reason.
 */

import type { PauseState } from './types';
import type { IntradayDecision } from './intradaySchedule';

/** Morning posts from 8:30 CT; closing from 3:15 CT; the summary at 4:30 CT. */
export const MORNING_MINUTE = 30;
export const CLOSING_MINUTE = 15;
export const SUMMARY_HOUR = 16;
export const SUMMARY_MINUTE = 30;
/** How long a due slot keeps retrying on stale data before giving up (minutes). */
export const STALE_RETRY_MIN = 30;

export type ActionKind = 'morning' | 'intraday' | 'closing' | 'summary' | 'wait' | 'idle';

export interface Action {
  kind: ActionKind;
  reason: string;
}

export interface TickInput {
  /** Chicago wall clock. */
  hour: number;
  minute: number;
  morningPosted: boolean;
  closingPosted: boolean;
  summarySent: boolean;
  /** True when the SPY snapshot is older than the freshness limit. */
  stale: boolean;
  /** The intraday decision for this tick (window + timer + break). */
  intraday: IntradayDecision;
}

/**
 * What this tick should do. Precedence follows the clock: the daily summary
 * after the close, the morning post in the 8 o'clock hour, the closing post
 * from 3:15, and intraday updates in between. A due market post on stale data
 * returns `wait` — the next 5-minute tick retries, which within each slot's
 * window covers the "retry for up to 30 min" rule without a separate counter.
 */
export function nextAction(input: TickInput): Action {
  const { hour, minute } = input;

  // After the close: send the day's summary once, then nothing more.
  if (hour > SUMMARY_HOUR || (hour === SUMMARY_HOUR && minute >= SUMMARY_MINUTE)) {
    if (!input.summarySent) return { kind: 'summary', reason: 'Daily summary due (4:30 CT).' };
    return { kind: 'idle', reason: 'After the close; summary already sent.' };
  }

  // Morning post: the 8 o'clock hour, from :30.
  if (hour === 8 && minute >= MORNING_MINUTE) {
    if (input.morningPosted) return { kind: 'idle', reason: 'Morning already posted.' };
    if (input.stale) return { kind: 'wait', reason: 'Morning due but SPY data is stale; will retry.' };
    return { kind: 'morning', reason: 'Morning post due (8:30 CT).' };
  }

  // Closing post: the 3 o'clock hour, from :15.
  if (hour === 15 && minute >= CLOSING_MINUTE) {
    if (input.closingPosted) return { kind: 'idle', reason: 'Closing already posted.' };
    if (input.stale) return { kind: 'wait', reason: 'Closing due but SPY data is stale; will retry.' };
    return { kind: 'closing', reason: 'Closing post due (3:15 CT).' };
  }

  // Intraday: a timed update or an immediate level break.
  if (input.intraday.post) {
    if (input.stale) return { kind: 'wait', reason: 'Intraday due but SPY data is stale; will retry.' };
    return { kind: 'intraday', reason: input.intraday.trigger ? `Level break (${input.intraday.trigger}).` : 'Timed intraday update.' };
  }

  return { kind: 'idle', reason: input.intraday.post === false ? input.intraday.reason : 'Nothing due.' };
}

// --- self-reporting: stale data during market hours --------------------------

/** Regular NYSE session on the Chicago clock: 8:30 AM through 3:00 PM CT. */
export const MARKET_OPEN_MIN = 8 * 60 + 30;
export const MARKET_CLOSE_MIN = 15 * 60;

/**
 * Should the "SPY data is stale during market hours" alarm fire this tick?
 *
 * The nightly health check grades freshness after the close, when a
 * close-of-session snapshot is legitimately the newest — so a feed that is
 * frozen all day still reads "OK" there. This is the missing market-hours
 * signal: while the regular session is open, data older than the 90-minute
 * limit is a failure even though every fetch returned HTTP 200. Throttled to
 * once an hour so a multi-hour outage sends one alert, not twelve.
 */
export function marketHoursStaleAlarm(input: {
  hour: number;
  minute: number;
  stale: boolean;
  staleAlertedAt?: string;
  now: Date;
}): boolean {
  if (!input.stale) return false;
  const m = input.hour * 60 + input.minute;
  if (m < MARKET_OPEN_MIN || m >= MARKET_CLOSE_MIN) return false;
  const last = Date.parse(input.staleAlertedAt ?? '');
  return !Number.isFinite(last) || input.now.getTime() - last >= 60 * 60 * 1000;
}

// --- self-healing: auto-resume -----------------------------------------------

/** One hour, the throttle for re-testing an auto-pause. */
const HOUR_MS = 60 * 60 * 1000;

export interface ResumeDecision {
  resume: boolean;
  reason?: string;
}

/**
 * Should a paused poster resume on its own this tick?
 *
 * - An owner "Pause today" auto-resumes on the next trading day (its stored
 *   date is no longer today).
 * - An auto-pause (401/billing) is optimistically re-tried once an hour: the
 *   poster resumes and lets the next real post attempt succeed or re-pause.
 * - An open-ended owner pause never auto-resumes — only the owner clears it.
 */
export function shouldAutoResume(pause: PauseState, today: string, now: Date): ResumeDecision {
  if (!pause.paused) return { resume: false };

  if (pause.by === 'owner') {
    if (pause.scope === 'today') {
      if (pause.date && pause.date !== today) {
        return { resume: true, reason: 'A "Pause today" auto-resumes on the next trading day.' };
      }
    }
    return { resume: false };
  }

  if (pause.by === 'auto') {
    const anchor = Date.parse(pause.lastRetestAt ?? pause.at ?? '');
    if (!Number.isFinite(anchor) || now.getTime() - anchor >= HOUR_MS) {
      return { resume: true, reason: 'Hourly re-test of an auth/billing pause.' };
    }
    return { resume: false };
  }

  return { resume: false };
}

// --- self-reporting ----------------------------------------------------------

export interface DayRow {
  slot: string;
  slotKey: string;
  outcome: 'sent' | 'skipped' | 'failed';
  reason?: string;
  at: string;
}

/**
 * How many of the most recent posting attempts today were skips or failures in
 * an unbroken run (a `sent` resets it). Drives the "3+ in a row" alarm.
 */
export function consecutiveSkips(rows: DayRow[]): number {
  const today = rows
    .filter((r) => r.at && r.slot !== 'summary')
    .sort((a, b) => b.at.localeCompare(a.at));
  let n = 0;
  for (const r of today) {
    if (r.outcome === 'sent') break;
    n += 1;
  }
  return n;
}

export interface DaySummary {
  subject: string;
  text: string;
  sent: number;
  skipped: number;
  failed: number;
}

/** The 4:30 CT daily summary email body, built from today's log rows. */
export function summariseDay(rows: DayRow[], date: string): DaySummary {
  const today = rows.filter((r) => r.slot !== 'summary');
  const sent = today.filter((r) => r.outcome === 'sent');
  const skipped = today.filter((r) => r.outcome === 'skipped');
  const failed = today.filter((r) => r.outcome === 'failed');

  const lines: string[] = [
    `GammaDesk X poster — daily summary for ${date}`,
    '',
    `Posts made: ${sent.length}`,
  ];
  for (const r of sent) lines.push(`  ✓ ${r.slot} (${r.slotKey})`);
  lines.push('', `Slots skipped: ${skipped.length}`);
  for (const r of skipped) lines.push(`  – ${r.slot}: ${r.reason ?? 'no reason logged'}`);
  if (failed.length > 0) {
    lines.push('', `Errors: ${failed.length}`);
    for (const r of failed) lines.push(`  ✗ ${r.slot}: ${r.reason ?? 'no reason logged'}`);
  }
  lines.push('', 'Full log: https://www.gammadesk.app/admin/x-posts');

  return {
    subject: `GammaDesk X: ${sent.length} posted, ${skipped.length} skipped${failed.length ? `, ${failed.length} errored` : ''} (${date})`,
    text: lines.join('\n'),
    sent: sent.length,
    skipped: skipped.length,
    failed: failed.length,
  };
}
