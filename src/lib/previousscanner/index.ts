import 'server-only';

import { getLiveOverlay, noOverlay } from '../live';
import type { LiveOverlay } from '../live/types';
import { legacyConfig as config } from './config';
import { peekScannerGamma } from './gamma';
import { readLatestScan, readTodaysScan, runScanner } from './run';
import type { ScanResult, ScanTimeframe, StoredGamma, VwapAnchor } from './types';

export { storeStatus } from '../jsonStore';
export { refreshScannerGamma, readTodaysGamma, peekScannerGamma } from './gamma';
export { runScanner, scanCandidates, readTodaysScan } from './run';

/**
 * The read path for /previousscanner.
 *
 * ## This one runs on demand, and the original did not
 *
 * The live scanner refuses to let a page view trigger its scan, for two good
 * reasons: the run spends the chain provider's daily budget, and its list is
 * only meaningful at the time it was scheduled for — a 2pm visit that quietly
 * re-ran it would print a different list under the morning's heading.
 *
 * Neither reason survives the move to a reference page. There is no cron for
 * this scanner and there is not going to be one; the Vercel cron slots are
 * full, and adding a scheduled job for a page kept only for reference would be
 * the wrong trade. Refusing to run would therefore mean the page was empty
 * forever, which is not a restoration of anything.
 *
 * It also costs no chains. Dealer gamma is read from the document the live
 * 08:30 job already stores — the same shape, unchanged between the two
 * versions — so a run here spends only bar series for the couple of dozen
 * names above the relative-strength floor. The result is stored under today's
 * date and read for the rest of the day, so the page is computed once.
 *
 * The consequence is stated on the page rather than hidden: this list was
 * produced whenever it was first asked for, not at 09:35, and VWAP — which
 * this build gates on — reads very differently at 2pm than five minutes after
 * the open.
 */
export interface ScannerView {
  /** Today's scan, or null when it has not run or could not be stored. */
  scan: ScanResult | null;
  /** The most recent stored scan whatever its date, for the "last ran" line. */
  latest: ScanResult | null;
  /** The stored gamma document, whatever its date. */
  gamma: StoredGamma | null;
  /** Wall-clock times the two jobs are scheduled for, from config. */
  schedule: { gammaEt: string; scanEt: string };
  rsMin: number;
  nw: { bandwidth: number; lookback: number; mult: number; minBars: number };
  trendEmaPeriod: number;
  vwapAnchor: Record<ScanTimeframe, VwapAnchor>;
  /**
   * Live prices, applied over the stored scan at read time and never into it.
   *
   * ## Read-time only, and that is a hard rule here
   *
   * This page stores its scan — computed the first time it is asked for each
   * day, then read all day. A live price written into that document would be
   * persisted, served to whoever opened the page next, and would outlive the
   * request that fetched it. That is the redistribution the token rule exists
   * to prevent, arriving by a slower route. So the overlay is assembled per
   * request, rendered, and thrown away; `run.ts` never sees it.
   *
   * ## It changes no verdict on this page
   *
   * Every gate here — VWAP, the trend EMA, the Nadaraya-Watson band — is
   * computed from bar series at scan time. A quote cannot recompute any of
   * them, and quietly substituting one into a gate would produce a pass or
   * fail that no stored number supports. The live price is shown beside the
   * scan's close and does nothing else: it answers "where is it now", which
   * the stored close cannot, and leaves "what did the scan decide" alone.
   */
  live: LiveOverlay;
}

/**
 * One run at a time, shared across concurrent visits.
 *
 * Without this, two people opening the page in the same few minutes would each
 * start a scan, doubling the bar requests to produce the same document twice.
 * Module-level, so it is per-instance rather than global — which is enough:
 * the worst case is one redundant run per cold instance, and the store write
 * is last-one-wins over identical data.
 */
let inFlight: Promise<ScanResult | null> | null = null;

async function todaysScanRunningIfNeeded(): Promise<ScanResult | null> {
  const stored = await readTodaysScan();
  if (stored) return stored;

  inFlight ??= runScanner()
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function getScannerView(): Promise<ScannerView> {
  const [scan, latest, gamma] = await Promise.all([
    todaysScanRunningIfNeeded(),
    readLatestScan(),
    peekScannerGamma(),
  ]);

  const tuning = config.scanner;

  const live = scan
    ? await getLiveOverlay(scan.rows.map((row) => row.symbol))
    : noOverlay('There is no scan, so there are no symbols to quote.');

  return {
    scan,
    latest,
    gamma,
    live,
    schedule: { gammaEt: tuning.gammaTimeEt, scanEt: tuning.scanTimeEt },
    rsMin: tuning.rsMin,
    nw: {
      bandwidth: tuning.nw.bandwidth,
      lookback: tuning.nw.lookback,
      mult: tuning.nw.mult,
      minBars: tuning.nw.minBars,
    },
    trendEmaPeriod: tuning.trendEmaPeriod,
    vwapAnchor: { ...tuning.vwapAnchor },
  };
}
