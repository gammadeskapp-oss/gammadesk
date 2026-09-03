import 'server-only';

import { getLiveOverlay } from '../../live';
import { barStore } from '../../rs/refresh';
import { SHARDS } from '../../rs/universe';
import { peekScannerGamma, readLatestScan, readTodaysScan } from '../../scanner';
import { peekStoredSectors } from '../../sectors';
import { SECTORS } from '../../sectors/definitions';
import type { ScanResult, StoredGamma } from '../../scanner/types';
import type { SectorsSnapshot } from '../../sectors/types';
import { evaluateSwing, type SectorReading, type TriggerContext } from './evaluate';
import {
  BREAKOUT_LOOKBACK,
  CONSOLIDATION_LOOKBACK,
  EXTENDED_EXCLUDE_PCT,
  HOLDING_WINDOW_DAYS,
  RS_STRONG,
  type SwingCandidate,
  type SwingDirection,
  type SwingExclusion,
  type SwingView,
} from './types';

/**
 * The read path for the swing candidate engine on /lab.
 *
 * ## It reuses engines and reads stores; it rebuilds nothing
 *
 * Every stored input here was written by a job that already runs — the scanner
 * (relative strength, the 20/50/200 trend stack, volume, earnings, the option
 * grade), the 08:30 gamma refresh (magnets and the flip level) and the /sectors
 * job (the nine-signal consensus and its momentum). This module joins them by
 * ticker and hands each name to the pure evaluator. It pulls no chain, ranks no
 * universe and grades no contract of its own.
 *
 * ## The one thing it computes fresh: a live price against stored levels
 *
 * A single live sweep over the scanned names, on the same `TRADIER_TOKEN`-gated
 * overlay every other private page here uses — absent in production, absent
 * without a token, and never written anywhere. The evaluator then measures the
 * trigger and the gamma room against that live price while every other reading
 * stays on its own refresh cadence. That split is the whole point of the engine
 * being live rather than a filtered scanner table, and it is stated on screen.
 *
 * ## Today's scan, or the last one, and it says which
 *
 * Like the rest of /lab and unlike /scanner, it falls back to the most recent
 * stored scan when today's has not run, and stamps the date. This is a research
 * surface being read to see what the method surfaces, not a shortlist under a
 * session heading, so an empty page before the morning job would answer less
 * than a dated one.
 */

/** How many excluded names to carry to the client. Enough to show the shape. */
const MAX_EXCLUSIONS = 40;

/** No trigger context — for names whose bar history could not be read. */
const NO_TRIGGER: TriggerContext = {
  high: null,
  low: null,
  rangeHigh: null,
  rangeLow: null,
  rangePct: null,
};

/**
 * The recent close-basis range for every name, from the stored bar shards.
 *
 * The same documents `scanner/averages.ts` reads for its moving averages, so
 * this costs no upstream request — it is a read of stored closing prices. Highs
 * and lows are of closes, not intraday prints, which is the one limitation the
 * card and the caveats state: the shards hold nothing finer than a daily close.
 */
async function readTriggerContext(): Promise<Map<string, TriggerContext>> {
  const bySymbol = new Map<string, TriggerContext>();

  const docs = await Promise.all(
    Array.from({ length: SHARDS }, (_, shard) => barStore(shard).read().catch(() => null)),
  );

  for (const doc of docs) {
    if (!doc) continue;
    for (const [symbol, raw] of Object.entries(doc.closes)) {
      const closes = raw.filter((c): c is number => c !== null && Number.isFinite(c));
      if (closes.length === 0) {
        bySymbol.set(symbol, NO_TRIGGER);
        continue;
      }
      const last = closes[closes.length - 1];

      const breakoutWindow = closes.slice(-BREAKOUT_LOOKBACK);
      const rangeWindow = closes.slice(-CONSOLIDATION_LOOKBACK);

      const high =
        breakoutWindow.length >= BREAKOUT_LOOKBACK ? Math.max(...breakoutWindow) : null;
      const low = breakoutWindow.length >= BREAKOUT_LOOKBACK ? Math.min(...breakoutWindow) : null;

      const rangeHigh =
        rangeWindow.length >= CONSOLIDATION_LOOKBACK ? Math.max(...rangeWindow) : null;
      const rangeLow =
        rangeWindow.length >= CONSOLIDATION_LOOKBACK ? Math.min(...rangeWindow) : null;
      const rangePct =
        rangeHigh !== null && rangeLow !== null && last > 0
          ? ((rangeHigh - rangeLow) / last) * 100
          : null;

      bySymbol.set(symbol, { high, low, rangeHigh, rangeLow, rangePct });
    }
  }

  return bySymbol;
}

/** Build the symbol → sector reading map from the stored snapshot. */
function sectorIndex(snapshot: SectorsSnapshot | null): Map<string, SectorReading> {
  const bySymbol = new Map<string, SectorReading>();
  if (!snapshot) return bySymbol;

  const byId = new Map(snapshot.sectors.map((s) => [s.id, s]));
  for (const def of SECTORS) {
    const sector = byId.get(def.id);
    if (!sector) continue;
    const reading: SectorReading = {
      name: sector.name,
      label: sector.consensus.label,
      delta5: sector.delta5,
    };
    for (const symbol of def.symbols) {
      // The definitions carry no duplicate across sectors (see
      // `duplicateSymbols`), so first-write-wins is not hiding a collision.
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, reading);
    }
  }
  return bySymbol;
}

function buildView(
  scan: ScanResult,
  gamma: StoredGamma | null,
  sectors: SectorsSnapshot | null,
  triggers: Map<string, TriggerContext>,
  live: Awaited<ReturnType<typeof getLiveOverlay>>,
  today: ScanResult | null,
): SwingView {
  /*
   * Gamma from a different session is treated as absent, exactly as /scanner
   * and /lab treat it: a flip level and magnets from Monday's chain measured
   * against a live price today are a reading of a different thing.
   */
  const gammaUsable = gamma !== null && gamma.date === scan.date;
  const sectorBySymbol = sectorIndex(sectors);
  const spyRegime = scan.spyRegime;

  const bullish: SwingCandidate[] = [];
  const bearish: SwingCandidate[] = [];
  const excluded: SwingExclusion[] = [];

  for (const row of scan.rows) {
    const entry = gammaUsable ? gamma.symbols[row.symbol] : undefined;
    const gammaInput = entry ? { magnets: entry.magnets, flipLevel: entry.flipLevel } : null;
    const sector = sectorBySymbol.get(row.symbol) ?? null;
    const quote = live.available ? live.quotes[row.symbol] : undefined;
    const livePrice = quote ? quote.last : null;

    for (const direction of ['bullish', 'bearish'] as SwingDirection[]) {
      const outcome = evaluateSwing({
        row,
        direction,
        spyRegime,
        sector,
        gamma: gammaInput,
        trigger: triggers.get(row.symbol) ?? NO_TRIGGER,
        livePrice,
      });
      if (outcome.kind === 'candidate') {
        (direction === 'bullish' ? bullish : bearish).push(outcome.candidate);
      } else if (outcome.kind === 'excluded' && excluded.length < MAX_EXCLUSIONS) {
        excluded.push(outcome.exclusion);
      }
    }
  }

  // Strongest alignment first, then by ticker for a stable order.
  const sortByStrength = (a: SwingCandidate, b: SwingCandidate) =>
    b.passed - a.passed || a.symbol.localeCompare(b.symbol);
  bullish.sort(sortByStrength);
  bearish.sort(sortByStrength);

  // --- notes and caveats -----------------------------------------------------
  const notes: string[] = [];

  if (!today) {
    notes.push(
      `Today's scan has not run. These candidates are built from the ${scan.date} scan, and every stored reading is as of that date. The trigger and gamma room are still measured against the live price.`,
    );
  }
  if (spyRegime === null) {
    notes.push(
      'No same-day SPY gamma is stored, so the market-regime check reads unknown for every name and nothing qualifies until it is available.',
    );
  }
  if (!gammaUsable) {
    notes.push(
      gamma === null
        ? 'No gamma document is stored, so no name carries a gamma-room reading. That does not exclude a name — absent gamma is "no reading", never "no room".'
        : `The stored gamma is dated ${gamma.date} and the scan is dated ${scan.date}. Gamma from another session is treated as absent, so no name carries a gamma-room reading this view.`,
    );
  }
  if (!sectors) {
    notes.push(
      'No /sectors snapshot is stored, so the sector-strength check reads unknown for every name and nothing qualifies until it is available.',
    );
  }
  if (live.available) {
    const covered = scan.rows.filter((r) => live.quotes[r.symbol]).length;
    notes.push(
      `Live prices are in use for ${covered} of ${scan.rows.length} names, read at ${live.capturedEt}${
        live.marketOpen
          ? ''
          : ' with the market closed, so these are last prints rather than moving quotes'
      }. Only the trigger and the gamma room are recomputed against them; trend, RS, sector and the option grade stay on their stored refresh cadence. Nothing live is written anywhere.`,
    );
  } else if (live.reason) {
    notes.push(
      `No live overlay: ${live.reason} The trigger and gamma room are therefore measured off the stored daily close, not a live quote, and are labelled accordingly on each card.`,
    );
  }

  const caveats: string[] = [
    'The market check is labelled "SPY regime" because it is exactly that: SPY’s stored gamma regime as the "not in breakdown" read. QQQ is not read separately — there is no stored QQQ gamma — so this is SPY alone until a QQQ positioning source exists.',
    `Trigger fires on any of three live setups: a reclaim of the 20-day average, a breakout past the ${BREAKOUT_LOOKBACK}-session high, or a tight ${CONSOLIDATION_LOOKBACK}-session consolidation with price at the top of the range. The breakout and consolidation ranges are computed from stored daily closes, so they are closing highs and lows, not intraday ones — an intraday high or an ATR/true-range series would sharpen both, and neither is stored today.`,
    'Volume reuses the RS engine’s recent-vs-baseline ratio (about 21 sessions against the 63 before), not literally today’s share count against a 20-day average — intraday volume is not stored. It answers the same "is participation picking up" question one refresh behind, and the card labels it as a session ratio rather than plain "volume".',
    `A name is hard-excluded as too extended only past ${EXTENDED_EXCLUDE_PCT}% from the 20-day average, wider than the ${5}% reclaim band — otherwise a genuine breakout that has cleared the average by more than a reclaim would could never qualify.`,
    `Relative strength passes at RS ${RS_STRONG}+ (the scanner’s shipped filter default), reused as published. The RS engine’s shortest window is one month, so the brief’s "1wk / 1mo" is really "1mo / 3mo / 6mo blend" — there is no one-week return in the digest.`,
    `Earnings uses a ${HOLDING_WINDOW_DAYS}-calendar-day holding window for the hard exclusion, wider than the scanner’s 10-day contract buffer because it is about holding the stock through a report. Only a known-and-inside date excludes; an unknown date is surfaced as its own state.`,
    'A sector-vs-SPY ratio was deliberately not built (the brief said not to). If it is ever wanted, it is a clean future branch: a stored ratio of each sector ETF against SPY would let the sector check compare strength rather than only consensus.',
  ];

  return {
    bullish,
    bearish,
    excluded,
    scanDate: scan.date,
    scannedAt: scan.scannedAt,
    live: {
      available: live.available,
      capturedEt: live.capturedEt,
      marketOpen: live.marketOpen,
    },
    notes,
    caveats,
  };
}

export async function getSwingView(): Promise<SwingView> {
  const [today, latest, gamma, sectors, triggers] = await Promise.all([
    readTodaysScan(),
    readLatestScan(),
    peekScannerGamma(),
    peekStoredSectors().catch(() => null),
    readTriggerContext().catch(() => new Map<string, TriggerContext>()),
  ]);

  const scan = today ?? latest;

  if (!scan) {
    return {
      bullish: [],
      bearish: [],
      excluded: [],
      scanDate: null,
      scannedAt: null,
      live: { available: false, capturedEt: null, marketOpen: false },
      notes: [
        'No scanner run is stored, so there are no names to evaluate. This engine reads the scanner’s stored document and never computes one — a page view here must not spend the chain budget.',
      ],
      caveats: [],
    };
  }

  // The live sweep is asked for after the scan, because the scan is what says
  // which symbols exist. It never throws and is absent in production.
  const live = await getLiveOverlay(scan.rows.map((r) => r.symbol));

  return buildView(scan, gamma, sectors, triggers, live, today);
}
