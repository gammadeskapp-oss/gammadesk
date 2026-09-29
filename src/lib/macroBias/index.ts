import 'server-only';

import { config } from '../config';
import { fetchFredSeries, FRED_SERIES } from './fred';
import { computeMacroBias } from './compute';
import { readMacroBiasDoc, writeMacroBiasDoc, type MacroBiasDoc } from './store';
import type { MacroBias } from './types';

export type { MacroBias, MacroFactor, FactorDirection } from './types';
export { storeStatus } from './store';

export interface RefreshResult {
  stored: boolean;
  bias: MacroBias | null;
  /** Set when FRED failed and the stored record was left untouched. */
  error?: string;
}

/**
 * Rebuild the Macro Bias record from FRED and store it. Called once a day by
 * the cron route.
 *
 * On any FRED failure the existing record is left in place and the error is
 * returned, not thrown — the daily job logging a miss is fine, blanking the box
 * because one refresh failed is not.
 */
export async function refreshMacroBias(): Promise<RefreshResult> {
  try {
    const [fed, tenYear, cpi] = await Promise.all([
      fetchFredSeries(FRED_SERIES.fedUpper),
      fetchFredSeries(FRED_SERIES.tenYear),
      fetchFredSeries(FRED_SERIES.cpi),
    ]);

    const bias = computeMacroBias(
      fed,
      tenYear,
      cpi,
      {
        fedLookbackDays: config.macroBias.fedLookbackDays,
        tenYearFlatPp: config.macroBias.tenYearFlatPp,
        cpiFlatPp: config.macroBias.cpiFlatPp,
      },
      new Date().toISOString(),
    );

    await writeMacroBiasDoc(bias);
    return { stored: true, bias };
  } catch (error) {
    return {
      stored: false,
      bias: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The stored record for the box to render. A pure read — no FRED call, no
 * compute — so it costs one storage read and never an upstream request. Null
 * when nothing has been stored yet (a fresh deploy before the first cron run),
 * which the box renders as "Updating…".
 */
export async function getMacroBias(): Promise<MacroBias | null> {
  const doc: MacroBiasDoc | null = await readMacroBiasDoc();
  return doc?.bias ?? null;
}
