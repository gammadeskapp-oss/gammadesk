import 'server-only';

import { storeStatus } from '../jsonStore';
import { episodicStore } from './refresh';
import {
  EPISODIC_CAPTURE,
  EPISODIC_DEFAULTS,
  EPISODIC_STRICT,
  type EpisodicFinding,
  type EpisodicView,
} from './types';

export { runEpisodicScan, runEpisodicBackfill } from './refresh';
export type { EpisodicRunReport, EpisodicBackfillReport } from './refresh';

/**
 * The read path for the episodic-pivot page.
 *
 * It reads the stored document the scan job wrote and nothing else — no fetch,
 * no scan. Opening the page costs the upstream nothing, which is the same rule
 * every other /lab surface follows: a page view must never be able to spend the
 * bar budget.
 *
 * The findings come back unsorted and at the full capture envelope; the board
 * sorts them and applies the display thresholds in the browser, so a reader can
 * tighten the filters without this running again.
 */

/**
 * Every judgment call and data gap the scan makes, in plain language. Surfaced
 * on the page rather than buried here, because a ranked list of tickers is only
 * honest if the reader can see the decisions behind it.
 */
const CAVEATS: string[] = [
  'This is a watchlist builder, not an entry signal. It finds names that gapped up from a quiet base and tracks what they have done since; it says nothing about whether to buy one, and there is no alert, no buy/sell wording and no outcome log anywhere in it.',
  '"Current price" is the most recent daily close, not a live quote — this is a daily-bars, after-the-close tool. A local Tradier overlay could refine it, and deliberately is not wired in.',
  'Bars are from Yahoo, split-adjusted (including recent reverse splits, which would otherwise read as fake gaps up) but not dividend-adjusted. Gaps, ranges and the close-in-top-half test are all measured on those daily OHLC values.',
  '"Held above the midpoint" is measured on daily closes, not intraday lows — a name that pierced the midpoint intraday and closed back above it still reads as holding. The chart shows the real path.',
  'The quiet-before test reads the spec\'s "50-day average volume was not already rising sharply" as: the average volume of the recent half of the 60-session base is no more than twice its earlier half. That multiple is a judgment call.',
  'The "no gap inside the prior 60 sessions" freshness rule checks for earlier gaps up of at least the same size; a large gap down in the base does not disqualify a name.',
  'The universe is the listed common-stock directory with ETFs removed — which also leaves a small tail of ADRs and closed-end funds carrying plain tickers. The $5 price and 500k average-volume floors remove the illiquid remainder, not that tail.',
  'Thresholds are re-applied in the browser over a stored scan, so they can tighten freely but only loosen down to the capture floor the scan kept. A genuinely wider net needs the scan to run again — a page view cannot start one.',
  'The universe is walked in slices across runs, so a name only appears once its slice has been scanned; the coverage line says where the last run reached.',
  '"Sessions since the gap" is counted in trading sessions, and the pause tracker\'s last-five readings stay blank until there are five sessions since the gap, so they never read off the gap day itself.',
];

export async function getEpisodicView(): Promise<EpisodicView> {
  const doc = await episodicStore.read().catch(() => null);
  const status = storeStatus();

  const base: Pick<EpisodicView, 'defaults' | 'capture' | 'strict' | 'storeDurable' | 'storeNote' | 'caveats'> = {
    defaults: EPISODIC_DEFAULTS,
    capture: EPISODIC_CAPTURE,
    strict: EPISODIC_STRICT,
    storeDurable: status.durable,
    storeNote: status.note,
    caveats: CAVEATS,
  };

  if (!doc || !doc.scanDate) {
    return {
      ...base,
      mode: 'daily',
      findings: [],
      calibration: null,
      trendRemoved: [],
      funnel: null,
      scanDate: null,
      scannedAt: null,
      notes: [
        'No scan has run yet, so there is nothing to show. This page reads a stored document and never computes one — the scan is a separate, flag-gated job. It will populate once that job has run.',
      ],
    };
  }

  const findings: EpisodicFinding[] = Object.values(doc.findings);
  const mode = doc.mode ?? 'daily';

  const notes: string[] = [];
  if (mode === 'backfill' && doc.calibration) {
    const c = doc.calibration;
    notes.push(
      `Historical backfill over ${c.months} months (gaps on or after ${c.fromDate}): ${findings.length} findings at the defaults across ${doc.universeSize} names.${c.complete ? '' : ' NB: the universe pass was incomplete, so these counts are partial.'}`,
    );
  } else {
    notes.push(
      `${findings.length} name(s) currently qualify, accumulated across runs. The most recent run, on ${doc.scanDate}, scanned ${doc.lastFunnel.scanned} of ${doc.universeSize} names in the universe.`,
    );
    if (doc.cursor !== 0) {
      notes.push(
        `A full pass is not yet complete: the next run resumes at position ${doc.cursor} of ${doc.universeSize}. Names past that point were scanned on an earlier run or not yet this pass.`,
      );
    }
  }
  for (const n of doc.notes) notes.push(n);

  return {
    ...base,
    mode,
    findings,
    calibration: doc.calibration ?? null,
    trendRemoved: doc.trendRemoved ?? [],
    funnel: doc.lastFunnel,
    scanDate: doc.scanDate,
    scannedAt: doc.updatedAt,
    notes,
  };
}
