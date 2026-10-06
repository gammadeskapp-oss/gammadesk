import 'server-only';

import { config } from '../config';
import { marketSessionRules } from '../events';
import { sendOwnerEmail } from '../health/email';
import { createJsonStore } from '../jsonStore';
import { marketToday } from '../time';
import { isTradingDay } from '../x/schedule';
import { runEarningsStep } from './earningsStore';
import { peekScannerGamma, refreshScannerGamma } from './gamma';
import { minutesEtNow } from './schedule';
import {
  gradeStoredScanContracts,
  readTodaysScan,
  runScanner,
  scanCandidates,
} from './run';

/**
 * The autonomous morning pipeline.
 *
 * ## Four steps, one tick driver, each in its own invocation
 *
 * The morning used to be two cron endpoints that each did several jobs inline —
 * the scan alone scored the index, looked earnings up, and graded two dozen
 * option chains, any one of which could push it past the platform's function
 * ceiling and leave the morning with nothing stored. It is now four small,
 * idempotent steps, each reading the step before it out of storage:
 *
 *   08:30  gamma      refresh dealer positioning for the whole ranked index
 *   09:00  earnings   look up the next report date for every ranked name
 *   09:35  scan       score and rank the index, reading gamma + earnings
 *   09:40  contracts  grade the top names' option chains onto the stored scan
 *
 * A single cron hits `/api/scanner/pipeline` every five minutes through the
 * morning (the same shape as the X poster's tick). Each tick runs **at most one
 * step** — the earliest one that is due, not yet done, and whose prerequisite
 * is in place — so no tick does more than one step's worth of work and the
 * 300-second budget is never in question. A step that throws is recorded as
 * failed and retried on later ticks up to `maxStepAttempts`; after that the
 * pipeline gives up on it and moves on, because the scan is designed to run
 * with whatever is in place (a name with no gamma simply carries an unmeasured
 * component — see `score.ts`).
 *
 * ## Why a tick driver and not four timed crons
 *
 * Vercel crons fire on a UTC clock and cannot retry. A single every-five-minutes
 * driver gives both the New-York-clock gating (via `minutesEtNow`) and the
 * retries for free, and it keeps the whole morning's state in one document the
 * admin page can render.
 */

export type StepName = 'gamma' | 'earnings' | 'scan' | 'contracts';
export const STEP_ORDER: StepName[] = ['gamma', 'earnings', 'scan', 'contracts'];

export const STEP_LABEL: Record<StepName, string> = {
  gamma: 'Gamma (dealer positioning)',
  earnings: 'Earnings dates',
  scan: 'Scan & score',
  contracts: 'Contract checks',
};

export type StepStatus = 'pending' | 'ok' | 'failed' | 'gave-up';

export interface StepState {
  status: StepStatus;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Last error, when the most recent attempt failed. */
  error: string | null;
  /** A short result line for the admin table, e.g. "494/503 chains". */
  summary: string | null;
}

export interface PipelineState {
  /** New York date this pipeline belongs to. */
  date: string;
  steps: Record<StepName, StepState>;
  health: { alerted: boolean; alertedAt: string | null; note: string | null };
  updatedAt: string;
}

function freshStep(): StepState {
  return {
    status: 'pending',
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
    summary: null,
  };
}

function freshState(date: string): PipelineState {
  return {
    date,
    steps: {
      gamma: freshStep(),
      earnings: freshStep(),
      scan: freshStep(),
      contracts: freshStep(),
    },
    health: { alerted: false, alertedAt: null, note: null },
    updatedAt: new Date().toISOString(),
  };
}

const pipelineStore = createJsonStore<PipelineState>(
  'gammadesk/scanner-pipeline.json',
  () => freshState(''),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as PipelineState;
    return doc.steps && typeof doc.steps === 'object' ? doc : null;
  },
);

/** The stored pipeline state for today, fresh if none exists yet. */
export async function readTodaysPipeline(): Promise<PipelineState> {
  const today = marketToday();
  const doc = await pipelineStore.read().catch(() => null);
  if (!doc || doc.date !== today) return freshState(today);
  return doc;
}

/** The raw stored document whatever its date, for the admin table. */
export function peekPipeline(): Promise<PipelineState | null> {
  return pipelineStore.read().catch(() => null);
}

// --- step start times, in New York minutes-past-midnight ---------------------

function stepStartEt(step: StepName): string {
  const s = config.scanner;
  return {
    gamma: s.gammaTimeEt,
    earnings: s.earningsTimeEt,
    scan: s.scanTimeEt,
    contracts: s.contractsTimeEt,
  }[step];
}

function hhmmToMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// --- running one step --------------------------------------------------------

/**
 * Run one step, returning its new state. Never throws: a step's own failure is
 * captured into `error` so the tick can record it and move on.
 */
async function runStep(step: StepName, prev: StepState): Promise<StepState> {
  const startedAt = new Date().toISOString();
  const attempts = prev.attempts + 1;
  try {
    const summary = await STEP_RUNNERS[step]();
    return {
      status: 'ok',
      attempts,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: null,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const gaveUp = attempts >= config.scanner.maxStepAttempts;
    return {
      status: gaveUp ? 'gave-up' : 'failed',
      attempts,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: message,
      summary: prev.summary,
    };
  }
}

const STEP_RUNNERS: Record<StepName, () => Promise<string>> = {
  gamma: async () => {
    const { rows } = await scanCandidates();
    const outcome = await refreshScannerGamma(
      rows.map((r) => ({ symbol: r.symbol, close: r.close })),
    );
    return `${outcome.refreshed}/${outcome.requested} chains (${outcome.failed} missing)`;
  },
  earnings: async () => {
    const outcome = await runEarningsStep();
    return `${outcome.dated}/${outcome.requested} names dated`;
  },
  scan: async () => {
    const result = await runScanner();
    const withGamma = result.coverage?.withGamma ?? 0;
    return `${result.scored} scored, ${withGamma} with gamma`;
  },
  contracts: async () => {
    const outcome = await gradeStoredScanContracts();
    if (outcome.date === null) throw new Error('no stored scan to grade');
    return `${outcome.graded}/${outcome.targeted} graded`;
  },
};

// --- the prerequisite between steps ------------------------------------------

/**
 * Whether `step` can run given the rest of the state.
 *
 * Only contracts has a hard prerequisite: it writes grades onto the stored
 * scan, so the scan must have stored first. Everything else is independent —
 * the scan deliberately runs on whatever gamma and earnings managed to store,
 * so a failed gamma never blocks it.
 */
function prerequisiteMet(step: StepName, state: PipelineState): boolean {
  if (step === 'contracts') return state.steps.scan.status === 'ok';
  return true;
}

export interface TickResult {
  date: string;
  ran: StepName | null;
  skippedReason: string | null;
  state: PipelineState;
  healthAlerted: boolean;
}

/**
 * One tick of the pipeline. Weekend/holiday aware, New-York-clock gated.
 */
export async function tickPipeline(now: Date = new Date()): Promise<TickResult> {
  const rules = marketSessionRules();
  const today = marketToday(now);

  if (!isTradingDay(today, rules)) {
    const state = freshState(today);
    return { date: today, ran: null, skippedReason: 'not a trading day (weekend or market holiday)', state, healthAlerted: false };
  }

  const state = await readTodaysPipeline();
  const nowEt = minutesEtNow(now);
  const maxAttempts = config.scanner.maxStepAttempts;

  // Find the earliest due, not-yet-done, not-given-up step whose prerequisite
  // is met, and run exactly that one.
  let ran: StepName | null = null;
  let skippedReason: string | null = null;

  for (const step of STEP_ORDER) {
    const s = state.steps[step];
    if (s.status === 'ok' || s.status === 'gave-up') continue;
    if (nowEt < hhmmToMinutes(stepStartEt(step))) {
      // Steps are time-ordered, so nothing later is due either.
      skippedReason = `next step (${step}) is not due until ${stepStartEt(step)} ET; it is ${String(Math.floor(nowEt / 60)).padStart(2, '0')}:${String(nowEt % 60).padStart(2, '0')} ET`;
      break;
    }
    if (s.attempts >= maxAttempts) continue;
    if (!prerequisiteMet(step, state)) {
      skippedReason = `${step} is waiting on an earlier step`;
      continue;
    }
    state.steps[step] = await runStep(step, s);
    ran = step;
    break;
  }

  // Health check, once per day, after the deadline.
  const healthAlerted = await maybeAlert(state, nowEt);

  state.updatedAt = new Date().toISOString();
  try {
    await pipelineStore.write(state);
  } catch {
    // The steps themselves persist their own results; losing the pipeline's
    // bookkeeping only costs the admin table and the retry counters, and the
    // next tick rebuilds from a fresh state rather than crashing.
  }

  return { date: today, ran, skippedReason, state, healthAlerted };
}

/**
 * Email the owner once if, past the deadline, the scan has not stored or too
 * many chains failed. Mutates `state.health`. Returns whether it alerted.
 */
async function maybeAlert(state: PipelineState, nowEt: number): Promise<boolean> {
  if (state.health.alerted) return false;
  if (nowEt < hhmmToMinutes(config.scanner.healthDeadlineEt)) return false;

  const problems: string[] = [];

  const scan = await readTodaysScan().catch(() => null);
  if (!scan) {
    problems.push(
      `The scan has not stored by ${config.scanner.healthDeadlineEt} ET. Scan step status: ${state.steps.scan.status}${state.steps.scan.error ? ` (${state.steps.scan.error})` : ''}.`,
    );
  }

  const gamma = await peekScannerGamma().catch(() => null);
  if (gamma && gamma.date === state.date && gamma.requested > 0) {
    const failRate = gamma.failures.length / gamma.requested;
    if (failRate > config.scanner.chainFailAlertPct) {
      problems.push(
        `${gamma.failures.length} of ${gamma.requested} gamma chains failed (${(failRate * 100).toFixed(0)}%, over the ${(config.scanner.chainFailAlertPct * 100).toFixed(0)}% threshold).`,
      );
    }
  }

  if (problems.length === 0) {
    // Healthy: mark the check done so it does not run every tick for the rest
    // of the morning.
    state.health = { alerted: true, alertedAt: new Date().toISOString(), note: 'healthy — no alert sent' };
    return false;
  }

  const subject = `GammaDesk scanner: morning run needs attention (${state.date})`;
  const body =
    `The morning scanner pipeline flagged a problem on ${state.date}:\n\n` +
    problems.map((p) => `• ${p}`).join('\n') +
    `\n\nStep status:\n` +
    STEP_ORDER.map(
      (step) =>
        `  ${STEP_LABEL[step]}: ${state.steps[step].status}` +
        (state.steps[step].summary ? ` — ${state.steps[step].summary}` : '') +
        (state.steps[step].error ? ` — ${state.steps[step].error}` : ''),
    ).join('\n') +
    `\n\nAdmin: https://www.gammadesk.app/admin/scanner\n`;

  const result = await sendOwnerEmail(subject, body).catch(() => ({ sent: false }));
  state.health = {
    alerted: true,
    alertedAt: new Date().toISOString(),
    note: result.sent ? `alert emailed: ${problems.length} problem(s)` : `alert NOT sent (${'skipped' in result ? result.skipped : 'mail error'})`,
  };
  return result.sent;
}
