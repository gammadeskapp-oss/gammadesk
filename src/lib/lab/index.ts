import 'server-only';

import { getFlowSnapshot } from '../flow';
import { peekScannerGamma, readLatestScan, readTodaysScan } from '../scanner';
import type { ScanResult, StoredGamma } from '../scanner/types';
import type { FlowSnapshot } from '../flow/types';
import type { LabFlow, LabRow, LabView } from './types';

export { getLabAnalogue } from './analogue';

/**
 * The read path for /lab.
 *
 * ## It reads stores and it reads nothing else
 *
 * Every number on this page has already been computed and stored by a job that
 * runs for the scanner, the gamma refresh or the flow scan. This module joins
 * three documents by ticker and does arithmetic on them. It pulls no chain, no
 * bar series and no quote, it writes nothing, and a page view here costs the
 * upstream providers exactly nothing.
 *
 * That is a hard constraint rather than a nicety. A research page whose own
 * page views spent the chain budget would degrade the pages that are actually
 * scheduled, and it would do it invisibly.
 *
 * The one exception is the analogue component, which cannot come from a store
 * because nothing stores it — see `analogue.ts`. It is fetched on demand, in
 * capped batches, and only when asked.
 *
 * ## Today's scan, or the last one, and it says which
 *
 * Unlike /scanner this falls back to the most recent stored scan when today's
 * has not run. The scanner refuses to, and is right to: a Tuesday list under a
 * Wednesday heading is the exact failure that page is arranged to prevent. But
 * this page has no heading claiming a session, it is not a shortlist, and it
 * is being read to compare a ranking method against itself over several days.
 * An empty page on a morning before 09:00 would answer nothing. So it shows
 * the last scan and stamps its date on every row.
 */

/** Percent from `from` to `to`, signed. Null when either is unusable. */
function pctTo(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return ((to - from) / from) * 100;
}

/**
 * The nearest stored magnet on each side of the close.
 *
 * The magnets on a row are the largest positive-gamma strikes, biggest first
 * and not sorted by price, so both sides have to be searched. A name whose
 * stored magnets all sit above the close has no magnet below it — that is
 * reported as an absent reading on that side rather than as a large distance,
 * because the chain has plenty of strikes below and none of them was large
 * enough to be stored. "None nearby" and "none stored" are different, and only
 * the second is what this actually knows.
 */
function magnetSides(price: number | null, magnets: { strike: number; gex: number }[]) {
  if (price === null || magnets.length === 0) {
    return { above: null, below: null };
  }

  let above: { strike: number; gex: number } | null = null;
  let below: { strike: number; gex: number } | null = null;

  for (const magnet of magnets) {
    if (!Number.isFinite(magnet.strike)) continue;
    if (magnet.strike >= price) {
      if (!above || magnet.strike < above.strike) above = magnet;
    } else if (!below || magnet.strike > below.strike) {
      below = magnet;
    }
  }

  return { above, below };
}

/**
 * One name's flow reading from the stored scan.
 *
 * Returns null for a name the scan never reached, and a populated reading with
 * `flagged: 0` for one it reached and found nothing on. The flow scan covers
 * the option universe in `lib/scanUniverse.ts` — around eighty names — so null
 * is the answer for most of the index, and the page says so once rather than
 * five hundred times.
 */
function flowIndex(snapshot: FlowSnapshot | null): Map<string, LabFlow> {
  const bySymbol = new Map<string, LabFlow>();
  if (!snapshot) return bySymbol;

  for (const summary of snapshot.symbols) {
    if (summary.failed) continue;
    bySymbol.set(summary.symbol, {
      flagged: 0,
      topVolumeToOi: null,
      topLabel: null,
      calls: 0,
      puts: 0,
      putCallVolume: summary.putCallVolume,
    });
  }

  for (const row of snapshot.rows) {
    const entry = bySymbol.get(row.symbol);
    if (!entry) continue;
    entry.flagged += 1;
    if (row.type === 'call') entry.calls += 1;
    else entry.puts += 1;
    if (entry.topVolumeToOi === null || row.volumeToOi > entry.topVolumeToOi) {
      entry.topVolumeToOi = row.volumeToOi;
      entry.topLabel = `${row.expiryLabel} ${row.strike} ${row.type}, ${row.volumeToOi.toFixed(1)}x volume to open interest`;
    }
  }

  return bySymbol;
}

function buildRows(
  scan: ScanResult,
  gamma: StoredGamma | null,
  flow: FlowSnapshot | null,
): LabRow[] {
  /*
   * Gamma from a different session is treated as absent, exactly as the
   * scanner treats it. A flip level computed against Monday's chain and
   * compared with Thursday's close is not a stale reading of the right thing,
   * it is a reading of a different thing.
   */
  const gammaUsable = gamma !== null && gamma.date === scan.date;
  const gammaStale =
    gamma !== null && gamma.date !== scan.date
      ? `the stored gamma is dated ${gamma.date} and this scan is dated ${scan.date}`
      : null;

  const pool = scan.scored;
  const flowBySymbol = flowIndex(flow);

  return scan.rows.map((row): LabRow => {
    const flowReading = flowBySymbol.get(row.symbol) ?? null;
    const entry = gammaUsable ? gamma.symbols[row.symbol] : undefined;
    const price = row.price;

    const chainNote = gammaStale
      ? `no usable chain — ${gammaStale}`
      : 'no chain was pulled for this name in the last gamma refresh';

    const flipLevel = entry?.flipLevel ?? null;
    const flipPct = pctTo(price, flipLevel);

    const { above, below } = magnetSides(price, entry ? entry.magnets : row.magnets);

    const magnetNote =
      above === null && below === null
        ? entry || row.magnets.length > 0
          ? price === null
            ? 'no close to measure a distance from'
            : 'no positive-gamma strike was large enough to be stored for this name'
          : chainNote
        : null;

    return {
      symbol: row.symbol,
      price,
      priceAsOf: row.priceAsOf,

      regime: row.regime,
      netGex: row.netGex,
      gammaNote: row.regime === null ? chainNote : null,

      flipLevel,
      flipPct,
      flipNote:
        flipPct !== null
          ? null
          : entry
            ? price === null
              ? 'no close to measure a distance from'
              : 'the chain has no sign change, so there is no flip level to measure to'
            : chainNote,

      magnetAbove: above,
      magnetAbovePct: pctTo(price, above ? above.strike : null),
      magnetBelow: below,
      magnetBelowPct: pctTo(price, below ? below.strike : null),
      magnetNote,

      rsScore: Number.isFinite(row.metrics.rsScore) ? row.metrics.rsScore : null,
      rsRank: Number.isFinite(row.metrics.rsRank) ? row.metrics.rsRank : null,
      rsPool: pool,
      rsNote: Number.isFinite(row.metrics.rsScore)
        ? null
        : 'the relative-strength engine could not rank this name',

      flow: flowReading,
      flowNote: flowReading
        ? null
        : flow
          ? 'the flow scan does not cover this name'
          : 'no flow scan is stored',

      analogue: null,
    };
  });
}

export async function getLabView(): Promise<LabView> {
  const [today, latest, gamma, flow] = await Promise.all([
    readTodaysScan(),
    readLatestScan(),
    peekScannerGamma(),
    getFlowSnapshot().catch(() => null),
  ]);

  const scan = today ?? latest;

  if (!scan) {
    return {
      rows: [],
      scanDate: null,
      scannedAt: null,
      gammaDate: gamma?.date ?? null,
      flowDate: flow?.sessionDate ?? null,
      coverage: {
        gammaRegime: 0,
        flipDistance: 0,
        magnetDistance: 0,
        rs: 0,
        flow: 0,
      },
      notes: [
        'No scanner run is stored at all, so there is nothing to rank. This page reads the scanner document and never computes one.',
      ],
    };
  }

  const rows = buildRows(scan, gamma, flow);

  const coverage = {
    gammaRegime: rows.filter((r) => r.regime !== null).length,
    flipDistance: rows.filter((r) => r.flipPct !== null).length,
    magnetDistance: rows.filter(
      (r) => r.magnetAbovePct !== null || r.magnetBelowPct !== null,
    ).length,
    rs: rows.filter((r) => r.rsScore !== null).length,
    flow: rows.filter((r) => r.flow !== null).length,
  };

  const notes: string[] = [];

  if (!today && latest) {
    notes.push(
      `Today's scan has not run. These readings are from the ${latest.date} scan, and every row is stamped with that date.`,
    );
  }

  if (!gamma) {
    notes.push(
      'No gamma document is stored, so gamma regime, flip distance and magnet distance are absent on every row rather than scored.',
    );
  } else if (gamma.date !== scan.date) {
    notes.push(
      `The stored gamma is dated ${gamma.date} and the scan is dated ${scan.date}. Gamma from another session is treated as absent, not as stale — a flip level from one session against a close from another is a reading of a different thing.`,
    );
  } else if (coverage.gammaRegime < rows.length) {
    notes.push(
      `${coverage.gammaRegime} of ${rows.length} names had a chain in the ${gamma.date} gamma refresh. The rest carry no gamma, flip or magnet reading, which is dropped from the blend rather than scored zero.`,
    );
  }

  if (!flow) {
    notes.push('No flow scan is stored, so the flow component is absent on every row.');
  } else if (coverage.flow < rows.length) {
    notes.push(
      `The flow scan covers ${coverage.flow} of these ${rows.length} names. A covered name that flagged nothing scores zero — the chain was looked at — while an uncovered name has no reading at all.`,
    );
  }

  notes.push(
    'The analogue hit rate is not stored anywhere and costs a full price history per name, so it is absent until you load it. Loading it changes the ranking of the names it loaded for and nothing else.',
  );

  return {
    rows,
    scanDate: scan.date,
    scannedAt: scan.scannedAt,
    gammaDate: gamma?.date ?? null,
    flowDate: flow?.sessionDate ?? null,
    coverage,
    notes,
  };
}
