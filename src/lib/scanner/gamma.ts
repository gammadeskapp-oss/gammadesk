import 'server-only';

import { config } from '../config';
import { buildPositioning } from '../exposure';
import { createJsonStore } from '../jsonStore';
import { runPool, runScan, SCAN_CONCURRENCY } from '../scanUniverse';
import { marketToday } from '../time';
import {
  fetchChainFor,
  resolveChainSource,
  type ResolvedChainSource,
} from './gammaSource';
import type { GammaEntry, Magnet, StoredGamma } from './types';

/**
 * The 08:30 ET gamma refresh.
 *
 * ## What this job used to be, and why it changed
 *
 * It used to refresh chains only for names that had already cleared a
 * relative-strength floor — about fifty of them — because Cboe's free feed
 * answers roughly sixty chain requests per window and then refuses. That is a
 * quota rather than a rate: running longer, slower, or on a bigger plan does
 * not raise it. Asking for less was the only lever, so the job asked for the
 * top of the list and the rest of the index went without.
 *
 * The cost of that was not obvious from the page. Two of the scanner's seven
 * scoring components come out of this document — the name's own dealer
 * positioning and its whole-chain option liquidity — so under Cboe, fifty
 * names were scored on seven readings and four hundred and fifty on five. The
 * two groups were never comparable, and the reason had nothing to do with any
 * of the stocks.
 *
 * On a paid Polygon options plan there is no per-minute quota, so this job now
 * asks for the whole ranked universe and the shortlisting is gone. The
 * fifteen-minute delay Polygon's plan carries is irrelevant to what is being
 * computed: gamma exposure is built from open interest, and open interest
 * publishes once a day after the close.
 *
 * Which provider actually served a run is decided in `gammaSource.ts`,
 * recorded per symbol, stored on the document, printed in the log line, and
 * shown on the page. There is no silent failover — falling back to Cboe means
 * going from five hundred chains to sixty, and a reader comparing two
 * mornings has to be able to see that.
 *
 * 08:30 is still the freshest the data gets: open interest publishes before
 * it, and nothing further arrives until tomorrow.
 *
 * ## One request per symbol, two answers
 *
 * The chain snapshot carries whole-chain volume and open interest alongside
 * the contracts (see `ChainActivityTotals`), so the option-liquidity component
 * comes out of the same fetch as the regime. Both adapters fill it in.
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
async function readSymbol(
  symbol: string,
  source: ResolvedChainSource,
  spotHint?: number,
): Promise<{ entry: GammaEntry; provider: string; fellBackFrom: string | null }> {
  const { snapshot, provider, fellBackFrom } = await fetchChainFor(symbol, source, spotHint);
  const now = new Date();

  const positioning = buildPositioning(snapshot.contracts, {
    symbol,
    spot: snapshot.spot,
    riskFreeRate: config.riskFreeRate,
    dividendYield: config.dividendYield,
    expirationCount: config.expirationCount,
    strikesEachSide: config.strikesEachSide,
    meta: {
      source: provider,
      sourceLabel:
        provider === 'polygon' ? 'Polygon (15-minute delayed)' : 'Cboe (delayed)',
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

  const entry: GammaEntry = {
    symbol,
    source: provider,
    regime: positioning.summary.regime,
    netGex: positioning.summary.netGex,
    spot: positioning.spot,
    flipLevel: positioning.summary.flipLevel,
    magnets: magnetsFrom(positioning.rows),
    // Absent only on adapters that cannot see the whole book. Both adapters
    // this job uses report it.
    optionsVolume: snapshot.activity?.volume ?? 0,
    optionsOpenInterest: snapshot.activity?.openInterest ?? 0,
    quoteDateIso: snapshot.quoteDate.toISOString(),
  };

  return { entry, provider, fellBackFrom };
}

export interface GammaRefreshOutcome {
  stored: StoredGamma;
  /** Chains that came back. */
  refreshed: number;
  failed: number;
  skipped: number;
  requested: number;
  /** What the run decided to use, and why. */
  source: ResolvedChainSource;
  /** Symbols the primary source could not serve. */
  fellBack: string[];
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
  /**
   * The names to refresh, each with the previous close the caller already
   * holds.
   *
   * The close is not decoration. Polygon's price endpoint is a stocks call
   * that an options plan does not cover, so a run without it queues sixty
   * seconds per symbol behind a five-a-minute limiter — which is the
   * difference between covering the index and covering two dozen names. The
   * scanner has this figure for every ranked name already.
   */
  candidates: Array<{ symbol: string; close: number | null }>,
): Promise<GammaRefreshOutcome> {
  const closes = new Map(candidates.map((c) => [c.symbol, c.close]));
  const wanted = [
    'SPY',
    ...candidates.map((c) => c.symbol).filter((s) => s !== 'SPY'),
  ];

  /*
   * The source is resolved once, before a single chain is spent, and it is the
   * first thing this job logs. On `auto` that costs one probe request and buys
   * the difference between "the whole index has gamma" and "sixty names do" —
   * which is worth knowing before the run rather than after it.
   */
  const source = await resolveChainSource();
  console.log(
    `[scanner/gamma] source=${source.primary} fallback=${source.fallback ?? 'none'} ` +
      `budget=${source.budget} wanted=${wanted.length} — ${source.reason}`,
  );

  const failures: Array<{ symbol: string; reason: string }> = [];
  const symbols: Record<string, GammaEntry> = {};
  /** Symbols the primary could not serve and the fallback could. */
  const fellBack: string[] = [];

  const read = async (symbol: string) => {
    try {
      const result = await readSymbol(symbol, source, closes.get(symbol) ?? undefined);
      symbols[symbol] = result.entry;
      if (result.fellBackFrom) fellBack.push(symbol);
    } catch (error) {
      failures.push({
        symbol,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /*
   * Two schedulers, because the two providers are constrained by different
   * things. Cboe is a quota — waves with a pause between them, which is what
   * `runScan` is for. Polygon is latency with no quota, and a wave scheduler
   * there runs at the speed of the slowest chain in each wave; a continuous
   * pool with a per-symbol deadline covers the index instead of a third of it.
   */
  const outcome: { skipped: string[]; timedOut?: string[] } =
    source.primary === 'polygon'
      ? await runPool(wanted, read, {
          concurrency: config.scanner.polygonConcurrency,
          maxRequests: source.budget,
          perSymbolMs: config.scanner.polygonSymbolTimeoutMs,
          // The route allows five minutes; stop well before it so the document
          // is still written rather than the run being killed mid-flight.
          budgetMs: 240_000,
        })
      : await runScan(wanted, read, {
          concurrency: SCAN_CONCURRENCY,
          maxRequests: source.budget,
          budgetMs: 240_000,
        });

  const timedOut = outcome.timedOut ?? [];

  const byProvider = { polygon: 0, cboe: 0 };
  for (const entry of Object.values(symbols)) {
    if (entry.source === 'polygon') byProvider.polygon += 1;
    else byProvider.cboe += 1;
  }

  const stored: StoredGamma = {
    date: marketToday(),
    refreshedAt: new Date().toISOString(),
    symbols,
    failures,
    skipped: outcome.skipped,
    requested: wanted.length,
    source: describeSource(source, byProvider, fellBack.length, timedOut.length),
    byProvider,
  };

  console.log(
    `[scanner/gamma] refreshed=${Object.keys(symbols).length}/${wanted.length} ` +
      `polygon=${byProvider.polygon} cboe=${byProvider.cboe} fellBack=${fellBack.length} ` +
      `failed=${failures.length} timedOut=${timedOut.length} skipped=${outcome.skipped.length}`,
  );

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
    source,
    fellBack,
  };
}

/**
 * The provenance sentence stored on the document and shown on the page.
 *
 * It names the counts rather than the intent, because the intent is what a
 * configuration flag would tell you and the counts are what actually happened.
 * A run that meant to use Polygon and served four hundred of its five hundred
 * chains from Cboe is a materially different document, and this is where a
 * reader finds that out.
 */
function describeSource(
  source: ResolvedChainSource,
  byProvider: { polygon: number; cboe: number },
  fellBack: number,
  timedOut: number,
): string {
  const parts: string[] = [];

  if (byProvider.polygon > 0 && byProvider.cboe > 0) {
    parts.push(
      `${byProvider.polygon} chains from Polygon (15-minute delayed) and ${byProvider.cboe} from Cboe`,
    );
  } else if (byProvider.polygon > 0) {
    parts.push(`Polygon (15-minute delayed), ${byProvider.polygon} chains`);
  } else if (byProvider.cboe > 0) {
    parts.push(`Cboe (delayed), ${byProvider.cboe} chains`);
  } else {
    parts.push('no chains were read');
  }

  if (fellBack > 0) {
    parts.push(
      `${fellBack} fell back from ${source.primary} after it could not serve them`,
    );
  }

  if (timedOut > 0) {
    parts.push(
      `${timedOut} were abandoned at the per-symbol deadline and carry no reading`,
    );
  }

  return `${parts.join('; ')}.`;
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
