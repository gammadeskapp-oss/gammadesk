import 'server-only';

import { config } from '../config';
import { dailyCounts, readArchive, averagePerDay, type DailyCount } from './archive';
import { peekScannerGamma } from './gamma';
import { readLatestScan, readTodaysScan } from './run';
import type { ScanResult, StoredGamma } from './types';

export { storeStatus } from '../jsonStore';
export {
  archiveScan,
  readArchive,
  dailyCounts,
  averagePerDay,
  ARCHIVE_KEEP_DAYS,
} from './archive';
export type { ArchivedDay, ArchivedName, DailyCount } from './archive';
export { refreshScannerGamma, readTodaysGamma, peekScannerGamma } from './gamma';
export { runScanner, scanCandidates, readTodaysScan, readLatestScan } from './run';

/**
 * The read path for /scanner.
 *
 * Reads storage and nothing else. Unlike every other page here, a visit must
 * never be able to trigger the work: the scan spends fifty Cboe chains and a
 * hundred and fifty bar series, and it is only meaningful at the time it was
 * scheduled for. A page load at 2pm that quietly re-ran the scan would print a
 * different list from the one the morning job produced, under the morning's
 * heading.
 *
 * So when today's scan is missing, this says so and shows when the last one
 * ran. That is a real answer, and the manual endpoint is how it gets fixed.
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
  /**
   * How many names passed each archived morning, newest first.
   *
   * On the page above the list, because the single most useful thing to know
   * about a shortlist of three is whether three is a normal day or a thin one.
   */
  counts: DailyCount[];
  /** Mean over the archived window, gate-shut zeros included. */
  averagePassed: number | null;
}

export async function getScannerView(): Promise<ScannerView> {
  const [scan, latest, gamma, archive] = await Promise.all([
    readTodaysScan(),
    readLatestScan(),
    peekScannerGamma(),
    // A stored read, so it costs the scan nothing.
    readArchive().catch(() => []),
  ]);

  const tuning = config.scanner;

  return {
    scan,
    latest,
    gamma,
    schedule: { gammaEt: tuning.gammaTimeEt, scanEt: tuning.scanTimeEt },
    rsMin: tuning.rsMin,
    nw: {
      bandwidth: tuning.nw.bandwidth,
      lookback: tuning.nw.lookback,
      mult: tuning.nw.mult,
      minBars: tuning.nw.minBars,
    },
    trendEmaPeriod: tuning.trendEmaPeriod,
    counts: dailyCounts(archive),
    averagePassed: averagePerDay(archive),
  };
}
