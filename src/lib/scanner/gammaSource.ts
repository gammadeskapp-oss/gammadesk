import 'server-only';

import { fetchCboeSnapshot } from '../cboe';
import { config } from '../config';
import { fetchPolygonChain, probePolygonOptions } from '../polygon';
import type { ChainSnapshot } from '../chainSource';

/**
 * Which provider serves the scanner's chains, decided once per run and said
 * out loud.
 *
 * ## The quota was the design constraint, and it is the thing being removed
 *
 * Cboe's free feed answers roughly sixty chain requests per window and then
 * refuses. That one number shaped the entire scanner: gamma could only be
 * refreshed for names that had already cleared a relative-strength floor, so
 * about fifty rows out of five hundred had a dealer-positioning reading and
 * the rest carried an unmeasured component through every downstream decision.
 *
 * A paid Polygon options plan has no per-minute quota, so the same job can ask
 * for the whole index. The fifteen-minute delay it comes with is irrelevant
 * here: gamma exposure is built from open interest, which publishes once a day
 * after the close, so a fifteen-minute-old quote carries the same exposure as
 * a live one.
 *
 * ## Cboe stays, as a fallback, and never as a silent one
 *
 * Every path through this file records which provider answered — per symbol,
 * in the stored document, in the run's log line, and on the page. A failover
 * that happened quietly would leave a reader looking at numbers whose
 * provenance, delay and coverage had all changed without anything saying so,
 * and the coverage change is the one that matters: falling back to Cboe means
 * going from five hundred chains to sixty.
 */

export type ChainProvider = 'polygon' | 'cboe';

export interface ResolvedChainSource {
  /** The provider to try first for every symbol this run. */
  primary: ChainProvider;
  /** The provider to try when the primary throws, or null for none. */
  fallback: ChainProvider | null;
  /** One sentence naming what was decided and why. Always populated. */
  reason: string;
  /**
   * Roughly how many chains this source can serve in one run.
   *
   * Cboe's is a measured quota. Polygon's is a wall-clock estimate rather than
   * an entitlement — unlimited calls still have to fit inside the platform's
   * function ceiling.
   */
  budget: number;
}

/**
 * Decide the source for this run.
 *
 * On `auto` — the default — this actually asks Polygon what the key can do
 * rather than assuming, because the failure mode of assuming is a run that
 * spends five minutes producing a page with no dealer positioning on any row.
 * The probe costs one request.
 */
export async function resolveChainSource(): Promise<ResolvedChainSource> {
  const pinned = config.scanGammaSource;

  if (pinned === 'cboe') {
    return {
      primary: 'cboe',
      fallback: null,
      reason:
        'Pinned to Cboe by GAMMADESK_SCAN_GAMMA_SOURCE. Cboe answers roughly sixty chains per window, so most of the index will carry no dealer-positioning reading.',
      budget: config.scanner.gammaRefreshBudget,
    };
  }

  if (!config.apiKey) {
    return {
      primary: 'cboe',
      fallback: null,
      reason:
        'No POLYGON_API_KEY is configured, so chains come from Cboe — roughly sixty per window, which is why most of the index carries no dealer-positioning reading.',
      budget: config.scanner.gammaRefreshBudget,
    };
  }

  const probe = await probePolygonOptions().catch(() => null);

  /*
   * Open interest is the one field that cannot be worked around. Every figure
   * this app derives from a chain is built from it, and no other Polygon
   * endpoint carries it — `/v3/reference/options/contracts` lists strikes and
   * expiries with no open interest at all, and per-contract aggregates give
   * volume only. So a key without it is not a degraded Polygon path; it is no
   * Polygon path, and the run says so rather than producing empty exposure.
   */
  if (!probe || !probe.available || !probe.hasOpenInterest) {
    const detail = probe?.detail ?? 'the entitlement probe itself failed';
    return {
      primary: 'cboe',
      fallback: null,
      reason: `Polygon is configured but its options snapshot is not usable: ${detail} Falling back to Cboe, which is rationed to roughly sixty chains per window.`,
      budget: config.scanner.gammaRefreshBudget,
    };
  }

  return {
    primary: 'polygon',
    fallback: pinned === 'polygon' ? null : 'cboe',
    reason:
      `Polygon options snapshot (15-minute delayed, unlimited calls). ${probe.detail} ` +
      (probe.hasImpliedVolatility
        ? 'Quoted IV is used where present and modelled where not.'
        : 'The snapshot carries no implied volatility, so IV is modelled from price for every contract — the same path Cboe rows take when a quote is missing.') +
      (pinned === 'polygon' ? ' Pinned, so there is no Cboe fallback.' : ' Cboe remains the per-symbol fallback.'),
    budget: config.scanner.polygonGammaBudget,
  };
}

export interface FetchedChain {
  snapshot: ChainSnapshot;
  /** Which provider actually answered for this symbol. */
  provider: ChainProvider;
  /** Set when the primary failed and the fallback answered. */
  fellBackFrom: ChainProvider | null;
}

/**
 * One symbol's chain from the resolved source, falling back per symbol.
 *
 * The fallback is per symbol rather than per run on purpose: one delisted
 * ticker Polygon has no chain for should cost that ticker a Cboe request, not
 * push the other five hundred onto a provider with a sixty-chain quota.
 */
export async function fetchChainFor(
  symbol: string,
  source: ResolvedChainSource,
): Promise<FetchedChain> {
  const fetchers: Record<ChainProvider, (s: string) => Promise<ChainSnapshot>> = {
    polygon: fetchPolygonChain,
    cboe: fetchCboeSnapshot,
  };

  try {
    return {
      snapshot: await fetchers[source.primary](symbol),
      provider: source.primary,
      fellBackFrom: null,
    };
  } catch (error) {
    if (!source.fallback) throw error;

    const snapshot = await fetchers[source.fallback](symbol);
    return {
      snapshot,
      provider: source.fallback,
      fellBackFrom: source.primary,
    };
  }
}
