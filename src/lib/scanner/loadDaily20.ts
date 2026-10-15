import 'server-only';

import { getRsResult } from '../rs';
import { DEFAULT_WEIGHTS } from '../rs/types';
import { getSectorsSnapshot } from '../sectors';
import { assembleDaily20, type Daily20, type Daily20Entry } from './daily20';
import type { RsWindows } from './daily20Gate';
import { readTodaysScan } from './run';
import {
  buildSectorConfirmations,
  sectorLookups,
  type SectorConfirm,
} from './sectorConfirmation';
import type { ScanResult } from './types';

/**
 * Assemble today's Daily 20 once, from the shared sources, so the scanner page
 * and the decision page cannot drift into building it differently.
 *
 * Reads the stored scan, the RS result (for the gate's window percentiles) and
 * the sectors snapshot (for the SECT component and the inline confirmation),
 * all stored-document reads that cost the scan nothing. Returns null when
 * there is no scan for today — the caller renders its own empty state.
 */
export interface LoadedDaily20 {
  scan: ScanResult;
  daily20: Daily20;
  sectorConfirmations: Map<string, SectorConfirm>;
}

export async function loadDaily20(): Promise<LoadedDaily20 | null> {
  const scan = await readTodaysScan().catch(() => null);
  if (!scan) return null;

  const [rsResult, sectorsSnap] = await Promise.all([
    getRsResult(DEFAULT_WEIGHTS).catch(() => null),
    getSectorsSnapshot().catch(() => null),
  ]);

  const rsPercentilesBySymbol = new Map<string, RsWindows>();
  if (rsResult) {
    for (const row of rsResult.rows) rsPercentilesBySymbol.set(row.symbol, row.percentiles);
  }

  const { infoBySymbol, strengthBySymbol } = sectorsSnap
    ? sectorLookups(sectorsSnap.sectors)
    : { infoBySymbol: new Map(), strengthBySymbol: new Map<string, number>() };

  const daily20 = assembleDaily20(scan.rows, {
    rsPercentilesBySymbol,
    sectorStrengthBySymbol: strengthBySymbol,
  });

  const above50BySymbol = new Map(
    scan.rows.map((r) => [
      r.symbol,
      r.metrics.pctAbove50 === null ? null : r.metrics.pctAbove50 >= 0,
    ]),
  );

  return {
    scan,
    daily20,
    sectorConfirmations: buildSectorConfirmations(daily20, infoBySymbol, above50BySymbol),
  };
}

/** Find a symbol's entry on either side of a Daily 20, or null. */
export function findEntry(daily20: Daily20, symbol: string): Daily20Entry | null {
  const up = symbol.toUpperCase();
  return (
    daily20.bullish.find((e) => e.symbol.toUpperCase() === up) ??
    daily20.bearish.find((e) => e.symbol.toUpperCase() === up) ??
    null
  );
}
