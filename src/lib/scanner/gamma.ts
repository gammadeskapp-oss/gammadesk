import 'server-only';

import { fetchCboeSnapshot } from '../cboe';
import { config } from '../config';
import { buildPositioning } from '../exposure';
import { createJsonStore } from '../jsonStore';
import { runScan, SCAN_CONCURRENCY } from '../scanUniverse';
import { marketToday } from '../time';
import type { GammaEntry, Magnet, StoredGamma } from './types';

/**
 * The 8:30 ET gamma refresh — filters 4 and 5.
 *
 * ## Why this job exists at all
 *
 * The nightly rotation in `velocity`/`flow` covers a quarter of the tracked
 * universe per night, because Cboe's free feed answers roughly sixty chain
 * requests per window and then refuses. That is a quota rather than a rate:
 * running longer, or slower, or on a bigger plan does not raise it. So any
 * given ticker's cached gamma can be up to four days old, which is fine for a
 * page about how positioning drifts and far too stale for a scan that runs
 * this morning.
 *
 * The way out is to ask for less. Only names that already cleared filter 1
 * need gamma at all — about fifty at the default RS floor of 82 — and fifty
 * fits inside one window. The nightly rotation keeps running unchanged for
 * every other page; this job is separate and its output is used by nothing
 * else.
 *
 * The margin is thinner than it looks. Fifty candidates plus SPY is fifty-one
 * chains against a window of roughly sixty, so the RS floor cannot drop much
 * further without the tail of the list going unrefreshed — and an unrefreshed
 * candidate reports its gamma filters as unknown, which excludes it. See
 * `config.scanner.gammaRefreshBudget`.
 *
 * 8:30 also happens to be the freshest the data gets: open interest publishes
 * before it, and nothing further arrives until tomorrow.
 *
 * ## One request per symbol, two answers
 *
 * The chain snapshot carries whole-chain volume and open interest alongside
 * the contracts (see `ChainActivityTotals`), so filter 3's options tier comes
 * out of the same fetch as filter 4's regime. Reading them separately would
 * have doubled the request count and put the job back over the quota.
 */

/** Magnet lines drawn on the expanded chart. */
const MAGNETS_PER_SYMBOL = 4;

export const gammaStore = createJsonStore<StoredGamma>(
  'gammadesk/scanner-gamma.json',
  () => ({
    date: '',
    refreshedAt: '',
    symbols: {},
    failures: [],
    skipped: [],
    requested: 0,
  }),
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as StoredGamma;
    return doc.symbols && typeof doc.symbols === 'object' ? doc : null;
  },
);

/**
 * The largest positive-GEX strikes, biggest first.
 *
 * Positive only, and deliberately not "largest by magnitude": a strike with
 * heavily negative gamma is a place dealers amplify moves, which is close to
 * the opposite of a magnet, and drawing the two in one list under one name
 * would teach the wrong thing.
 */
function magnetsFrom(rows: Array<{ strike: number; total: { gex: number } }>): Magnet[] {
  return rows
    .filter((r) => r.total.gex > 0)
    .sort((a, b) => b.total.gex - a.total.gex)
    .slice(0, MAGNETS_PER_SYMBOL)
    .map((r) => ({ strike: r.strike, gex: r.total.gex }));
}

/** One symbol's chain, reduced to what the scanner stores. */
async function readSymbol(symbol: string): Promise<GammaEntry> {
  const snapshot = await fetchCboeSnapshot(symbol);
  const now = new Date();

  const positioning = buildPositioning(snapshot.contracts, {
    symbol,
    spot: snapshot.spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    expirationCount: config.expirationCount,
    strikesEachSide: config.strikesEachSide,
    meta: {
      source: 'cboe',
      sourceLabel: 'Cboe (delayed)',
      asOfLabel: '',
      asOfIso: now.toISOString(),
      quoteDateLabel: '',
      quoteDateIso: snapshot.quoteDate.toISOString(),
      cacheSeconds: config.cacheSeconds,
      upstreamRequests: snapshot.requests,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      notes: snapshot.notes,
    },
  });

  return {
    symbol,
    regime: positioning.summary.regime,
    netGex: positioning.summary.netGex,
    spot: positioning.spot,
    flipLevel: positioning.summary.flipLevel,
    magnets: magnetsFrom(positioning.rows),
    // Absent only on adapters that cannot see the whole book. On Cboe, which
    // is what this job uses, it is always present.
    optionsVolume: snapshot.activity?.volume ?? 0,
    optionsOpenInterest: snapshot.activity?.openInterest ?? 0,
    quoteDateIso: snapshot.quoteDate.toISOString(),
  };
}

export interface GammaRefreshOutcome {
  stored: StoredGamma;
  /** Chains that came back. */
  refreshed: number;
  failed: number;
  skipped: number;
  requested: number;
}

/**
 * Refresh gamma for `candidates`, plus SPY.
 *
 * SPY goes first and is never dropped by the budget. Filter 5 gates the whole
 * scan on it, so a run that reached fifty stocks and missed SPY has produced
 * nothing usable — the scan would have to refuse for lack of the gate, and
 * every chain it spent would be wasted.
 *
 * A symbol that fails is recorded with its reason rather than omitted. The
 * scan reads this document and needs to tell "gamma is negative" apart from
 * "we never got the chain", and the two are different filter states.
 */
export async function refreshScannerGamma(
  candidates: string[],
): Promise<GammaRefreshOutcome> {
  const wanted = ['SPY', ...candidates.filter((s) => s !== 'SPY')];

  const failures: Array<{ symbol: string; reason: string }> = [];
  const symbols: Record<string, GammaEntry> = {};

  const outcome = await runScan(
    wanted,
    async (symbol) => {
      try {
        symbols[symbol] = await readSymbol(symbol);
      } catch (error) {
        failures.push({
          symbol,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      concurrency: SCAN_CONCURRENCY,
      maxRequests: config.scanner.gammaRefreshBudget,
      // The route allows five minutes; stop well before it so the document is
      // still written rather than the run being killed mid-flight.
      budgetMs: 240_000,
    },
  );

  const stored: StoredGamma = {
    date: marketToday(),
    refreshedAt: new Date().toISOString(),
    symbols,
    failures,
    skipped: outcome.skipped,
    requested: wanted.length,
  };

  try {
    await gammaStore.write(stored);
  } catch {
    // Serve what was computed even if it could not be persisted. The scan an
    // hour later reads storage, so a failed write means it will report the
    // gamma as missing — which is the honest outcome, not a silent fallback
    // to yesterday's numbers.
  }

  return {
    stored,
    refreshed: Object.keys(symbols).length,
    failed: failures.length,
    skipped: outcome.skipped.length,
    requested: wanted.length,
  };
}

/**
 * The stored refresh, or null when there is nothing usable for today.
 *
 * Deliberately date-checked: the whole point of this job is that the scanner
 * never reads stale gamma. A document from a previous session is not a
 * degraded answer, it is the wrong answer, and the caller renders the filters
 * as unknown with the date stated rather than passing names on yesterday's
 * regime.
 */
export async function readTodaysGamma(): Promise<StoredGamma | null> {
  const doc = await gammaStore.read().catch(() => null);
  if (!doc || !doc.date) return null;
  return doc.date === marketToday() ? doc : null;
}

/** The stored document whatever its date, for the health and status lines. */
export function peekScannerGamma(): Promise<StoredGamma | null> {
  return gammaStore.read().catch(() => null);
}
