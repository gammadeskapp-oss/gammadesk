import 'server-only';

import { createJsonStore, storeStatus } from '../jsonStore';
import { runPool } from '../scanUniverse';
import { marketToday } from '../time';
import { fetchDailyBarsDetailed } from './bars';
import { scanSeries, type ScanDrop } from './scan';
import {
  EPISODIC_CAPTURE,
  EPISODIC_SCHEMA,
  type EpisodicFinding,
  type EpisodicFunnel,
} from './types';
import { getEpisodicUniverse } from './universe';

/**
 * The scan job: fetch daily bars across the universe, run the pure scan, and
 * store what qualifies.
 *
 * ## Why this is a stored job and never a page view
 *
 * It pulls a year of daily bars for thousands of symbols. That cannot happen on
 * a page render — it would put the whole universe behind one reader's request —
 * so, exactly like the rest of /lab, the page reads a document this job wrote.
 * The job is flag-gated and cron-authed at the route; there is deliberately no
 * `vercel.json` entry for it (see the route), because in production the flag is
 * off and the scan is a local-only research sweep.
 *
 * ## One long run, with a cursor as a safety net
 *
 * A generous time budget lets a single local run cover the whole universe and
 * produce a clean funnel over all of it. If a run is cut short — the budget, a
 * slow upstream — the cursor advances so the next run continues where this one
 * stopped, and findings accumulate across runs rather than being thrown away.
 * This is the same cursor-walk `rs/refresh.ts` uses, kept deliberately simple:
 * a symbol the run actually evaluated is upserted (a finding) or removed (no
 * longer qualifies); a symbol it never reached is left exactly as it was.
 *
 * ## Freshness
 *
 * A gap is only interesting while it is recent, so a stored finding is evicted
 * once its gap ages past `GAP_MAX_AGE_DAYS` or it has not been re-confirmed in
 * `STALE_DAYS`. Without this a name that qualified a month ago would sit on the
 * list forever, its pause tracker frozen on the day its slice last ran.
 */

/** Symbols fetched at once. Yahoo absorbed 20 comfortably in the RS refresh. */
const CONCURRENCY = 24;

/**
 * Wall-clock budget. The route is capped at 300s; stopping at 240 leaves room
 * to write a document that may hold thousands of bars.
 */
const BUDGET_MS = 240_000;

/** Longest one symbol may hold a worker before it is abandoned. */
const PER_SYMBOL_MS = 15_000;

/**
 * Symbols one run will attempt. High enough that a local run covers the whole
 * universe in one pass; the cursor handles the case where the budget bites
 * first. Not a quota like the Cboe scans — Yahoo has no per-window ceiling here.
 */
const MAX_REQUESTS = 8_000;

/** A gap older than this (calendar days) has aged out of the recent window. */
const GAP_MAX_AGE_DAYS = 45;

/** A finding not re-confirmed within this many days is dropped as stale. */
const STALE_DAYS = 14;

// --- the stored document -----------------------------------------------------

interface StoredFinding extends EpisodicFinding {
  /** ISO timestamp this finding was last confirmed by a run. */
  scannedAt: string;
}

interface EpisodicStore {
  schema: number;
  /** ISO timestamp of the most recent run. */
  updatedAt: string;
  /** New York date of the most recent run. */
  scanDate: string;
  /** Where the next run starts in the universe list. */
  cursor: number;
  /** Universe size at the most recent run, for the page's coverage line. */
  universeSize: number;
  /** The most recent run's funnel over its slice. */
  lastFunnel: EpisodicFunnel;
  /** Every accumulated finding, keyed by symbol. */
  findings: Record<string, StoredFinding>;
  notes: string[];
}

function emptyStore(): EpisodicStore {
  return {
    schema: EPISODIC_SCHEMA,
    updatedAt: new Date(0).toISOString(),
    scanDate: '',
    cursor: 0,
    universeSize: 0,
    lastFunnel: {
      universe: 0,
      scanned: 0,
      droppedShortHistory: 0,
      droppedLiquidity: 0,
      droppedNoGap: 0,
      droppedNotFresh: 0,
      droppedBaseTooWide: 0,
      droppedBaseTrending: 0,
      droppedBaseVolRising: 0,
      survived: 0,
      fetchFailed: 0,
      notReached: 0,
    },
    findings: {},
    notes: [],
  };
}

export const episodicStore = createJsonStore<EpisodicStore>(
  'gammadesk/episodic.json',
  emptyStore,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as EpisodicStore;
    if (doc.schema !== EPISODIC_SCHEMA) return null;
    if (!doc.findings || typeof doc.findings !== 'object') return null;
    return doc;
  },
);

// --- the worker outcome ------------------------------------------------------

type WorkerResult =
  | { symbol: string; kind: 'finding'; finding: EpisodicFinding }
  | { symbol: string; kind: 'drop'; reason: ScanDrop }
  | { symbol: string; kind: 'fetch-failed' };

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

/** Calendar days between a `YYYY-MM-DD` date and today. */
function ageOfDate(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

export interface EpisodicRunReport {
  scanDate: string;
  universeSize: number;
  funnel: EpisodicFunnel;
  totalFindings: number;
  cursor: number;
  wrapped: boolean;
  /** Whether this environment's store is configured to persist across deploys. */
  durable: boolean;
  /**
   * Whether the write actually landed. Distinct from `durable`: a Blob store
   * can be "durable" by configuration yet reject the write for a bad token,
   * which is precisely what must not be reported as success.
   */
  stored: boolean;
  notes: string[];
}

export async function runEpisodicScan(): Promise<EpisodicRunReport> {
  const universe = await getEpisodicUniverse();
  const previous = await episodicStore.read().catch(() => emptyStore());

  const symbols = universe.symbols;
  const universeSize = symbols.length;
  const notes: string[] = [];

  if (universe.fromStub) {
    notes.push(
      'The symbol directory fell back to its built-in stub, so this run scanned only a couple of dozen names. It is a smoke test, not a real sweep — the directory feed was unreachable.',
    );
  }

  // The slice this run takes, starting where the last one stopped.
  const start = universeSize > 0 ? ((previous.cursor % universeSize) + universeSize) % universeSize : 0;
  const slice = symbols.slice(start, start + MAX_REQUESTS);

  const nameOf = new Map(symbols.map((s) => [s.symbol, s.name]));

  /*
   * Failure diagnostics, so a run can say *why* it failed rather than only how
   * often. Rate-limiting (HTTP 429), a dead upstream (other HTTP), a hung
   * request (aborted) and a genuinely unknown ticker (no data) are four very
   * different problems, and the fix for each is different. Logged periodically
   * to the dev/server console during the run, and folded into the notes at the
   * end.
   */
  const diag = { http429: 0, httpOther: 0, aborted: 0, noData: 0, otherErr: 0, done: 0 };
  const runStart = Date.now();

  /*
   * Reverse-split audit. A reverse split (ratio < 1) is a fake gap *up* if left
   * raw — the single worst false positive this scanner could produce — so every
   * run records the recent reverse splits it corrected for and whether the name
   * still surfaced as a finding. If the split handling works, that list is long
   * and none of it is a finding; if a reverse split ever shows up as a gap, this
   * is where it becomes visible instead of silently topping the ranking.
   */
  const reverseSplits: Array<{ symbol: string; date: string; ratio: number; becameFinding: boolean }> = [];
  const recentSplitWindowDays = 90;

  const worker = async (symbol: string): Promise<WorkerResult> => {
    let detailed;
    try {
      detailed = await fetchDailyBarsDetailed(symbol);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/HTTP 429/.test(msg)) diag.http429 += 1;
      else if (/HTTP \d/.test(msg)) diag.httpOther += 1;
      else if (/abort|timeout/i.test(msg)) diag.aborted += 1;
      else diag.otherErr += 1;
      return { symbol, kind: 'fetch-failed' };
    } finally {
      diag.done += 1;
      if (diag.done % 500 === 0) {
        const secs = (Date.now() - runStart) / 1000;
        console.warn(
          `[episodic] ${diag.done} done in ${secs.toFixed(0)}s (${(diag.done / secs).toFixed(1)}/s) — ` +
            `429:${diag.http429} httpOther:${diag.httpOther} aborted:${diag.aborted} noData:${diag.noData} err:${diag.otherErr} revSplits:${reverseSplits.length}`,
        );
      }
    }
    if (!detailed) {
      diag.noData += 1;
      return { symbol, kind: 'fetch-failed' };
    }

    const result = scanSeries(symbol, nameOf.get(symbol) ?? null, detailed.bars, EPISODIC_CAPTURE);
    const becameFinding = result.kind === 'finding';

    for (const s of detailed.applied) {
      if (s.ratio < 1 && ageOfDate(s.date) <= recentSplitWindowDays) {
        reverseSplits.push({ symbol, date: s.date, ratio: s.ratio, becameFinding });
      }
    }

    return becameFinding
      ? { symbol, kind: 'finding', finding: result.finding }
      : { symbol, kind: 'drop', reason: (result as { reason: ScanDrop }).reason };
  };

  console.warn(
    `[episodic] starting: universe ${universeSize}, slice ${slice.length} from ${start}, concurrency ${CONCURRENCY}`,
  );

  const { results, covered, skipped, timedOut } = await runPool(slice.map((s) => s.symbol), worker, {
    concurrency: CONCURRENCY,
    budgetMs: BUDGET_MS,
    perSymbolMs: PER_SYMBOL_MS,
    maxRequests: MAX_REQUESTS,
  });

  // --- build the funnel from this run's slice --------------------------------
  const funnel: EpisodicFunnel = {
    universe: universeSize,
    scanned: covered.length,
    droppedShortHistory: 0,
    droppedLiquidity: 0,
    droppedNoGap: 0,
    droppedNotFresh: 0,
    droppedBaseTooWide: 0,
    droppedBaseTrending: 0,
    droppedBaseVolRising: 0,
    survived: 0,
    // A timed-out symbol produced no reading, so it counts with the fetch
    // failures rather than as a verdict.
    fetchFailed: timedOut.length,
    notReached: skipped.length,
  };

  const dropBucket: Record<ScanDrop, keyof EpisodicFunnel> = {
    'short-history': 'droppedShortHistory',
    liquidity: 'droppedLiquidity',
    'no-gap': 'droppedNoGap',
    'not-fresh': 'droppedNotFresh',
    'base-too-wide': 'droppedBaseTooWide',
    'base-trending': 'droppedBaseTrending',
    'base-vol-rising': 'droppedBaseVolRising',
  };

  const now = new Date().toISOString();
  const scanDate = marketToday();

  // Start from the previous findings and apply this run's verdicts. A symbol we
  // actually evaluated is upserted or removed; one we never reached is left be.
  const findings: Record<string, StoredFinding> = { ...previous.findings };

  for (const r of results) {
    if (r.kind === 'fetch-failed') {
      funnel.fetchFailed += 1;
      // Leave any existing finding untouched — we could not re-verify it.
      continue;
    }
    if (r.kind === 'drop') {
      funnel[dropBucket[r.reason]] = (funnel[dropBucket[r.reason]] as number) + 1;
      // Evaluated and did not qualify: remove any stale finding for it.
      delete findings[r.symbol];
      continue;
    }
    funnel.survived += 1;
    findings[r.symbol] = { ...r.finding, scannedAt: now };
  }

  // --- evict aged and stale findings -----------------------------------------
  let evictedAged = 0;
  let evictedStale = 0;
  for (const [symbol, f] of Object.entries(findings)) {
    if (ageOfDate(f.gapDate) > GAP_MAX_AGE_DAYS) {
      delete findings[symbol];
      evictedAged += 1;
    } else if (daysSince(f.scannedAt) > STALE_DAYS) {
      delete findings[symbol];
      evictedStale += 1;
    }
  }
  if (evictedAged > 0) {
    notes.push(`${evictedAged} finding(s) evicted: their gap aged past ${GAP_MAX_AGE_DAYS} days.`);
  }
  if (evictedStale > 0) {
    notes.push(
      `${evictedStale} finding(s) evicted: not re-confirmed within ${STALE_DAYS} days, so their pause tracker could not be trusted.`,
    );
  }

  const elapsedS = (Date.now() - runStart) / 1000;
  console.warn(
    `[episodic] finished ${covered.length} names in ${elapsedS.toFixed(0)}s — ` +
      `429:${diag.http429} httpOther:${diag.httpOther} aborted:${diag.aborted} noData:${diag.noData} err:${diag.otherErr} survived:${funnel.survived}`,
  );

  // Reverse-split audit. Any reverse split that leaked through as a finding is a
  // real bug and must shout; a clean run confirms the adjustment is working on
  // live data, not just synthetic tests.
  const revLeaked = reverseSplits.filter((r) => r.becameFinding);
  console.warn(
    `[episodic] reverse-split audit: ${reverseSplits.length} recent reverse split(s) corrected across the run; ` +
      `${revLeaked.length} leaked into findings${revLeaked.length ? ' -> ' + revLeaked.map((r) => `${r.symbol}@${r.date}`).join(', ') : ''}`,
  );
  console.warn(
    `[episodic] reverse-split sample: ${reverseSplits.slice(0, 12).map((r) => `${r.symbol}(${r.ratio.toFixed(3)}@${r.date})`).join(', ')}`,
  );
  if (reverseSplits.length > 0) {
    notes.push(
      `Reverse-split audit: corrected ${reverseSplits.length} recent reverse split(s); ${revLeaked.length} slipped through as a finding${revLeaked.length ? ` (${revLeaked.map((r) => r.symbol).join(', ')}) — this is a bug` : ' — split handling held'}.`,
    );
  }
  if (diag.http429 > 0) {
    notes.push(
      `Yahoo rate-limited this run ${diag.http429} time(s) (HTTP 429). Those names were not evaluated and will be retried on the next pass.`,
    );
  }
  notes.push(
    `Run took ${elapsedS.toFixed(0)}s for ${covered.length} names (${(covered.length / Math.max(elapsedS, 1)).toFixed(1)}/s). Fetch outcomes — 429: ${diag.http429}, other HTTP: ${diag.httpOther}, timed out: ${diag.aborted + timedOut.length}, no data: ${diag.noData}, other error: ${diag.otherErr}.`,
  );

  const covedEnd = start + covered.length;
  const wrapped = covedEnd >= universeSize;
  const nextCursor = universeSize > 0 ? covedEnd % universeSize : 0;

  if (skipped.length > 0) {
    notes.push(
      `The time budget ran out after ${covered.length} of this slice's ${slice.length} names; the next run resumes at position ${nextCursor} of ${universeSize}.`,
    );
  } else if (!wrapped) {
    notes.push(
      `This run covered names ${start}–${covedEnd} of ${universeSize}; the next run continues from there. A full pass is complete when the cursor returns to 0.`,
    );
  }

  const status = storeStatus();
  const next: EpisodicStore = {
    schema: EPISODIC_SCHEMA,
    updatedAt: now,
    scanDate,
    cursor: nextCursor,
    universeSize,
    lastFunnel: funnel,
    findings,
    notes,
  };

  let stored = true;
  try {
    await episodicStore.write(next);
  } catch (error) {
    stored = false;
    notes.push(
      `The scan ran but could not be stored (${status.kind} store): ${error instanceof Error ? error.message : String(error)}. Nothing was persisted, so the page will not see this run.`,
    );
  }

  return {
    scanDate,
    universeSize,
    funnel,
    totalFindings: Object.keys(findings).length,
    cursor: nextCursor,
    wrapped,
    durable: status.durable,
    stored,
    notes,
  };
}
