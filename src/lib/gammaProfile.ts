import { formatExpiryLabel } from './time';
import { nearestStrongWall } from './simple/walls';
import type { PositioningData } from './types';

/**
 * The strike-by-strike gamma profile, precomputed on the server.
 *
 * ## Why this is not derived in the chart
 *
 * The chart is a client component, and everything it draws has to agree with
 * the levels the rest of the page already states. Two things follow from that.
 *
 * The flip level is *not* recomputed here or in the browser: it is a search
 * over hypothetical spot prices (see `findGammaFlip`), it already ran once
 * when the snapshot was built, and running a second copy of it — in different
 * code, at a different precision — is how a chart ends up drawing its line at
 * a price the sentence above it does not name. The same goes for the magnets,
 * which come from the shared `nearestStrongWall` rule.
 *
 * And the per-strike numbers are shaped once, here, into a flat array. The
 * browser receives `{strike, callGex, putGex, netGex, oiCall, oiPut}` and adds
 * nothing to it but layout.
 *
 * ## Caching
 *
 * Keyed on the snapshot object itself, which `getPositioningView` holds for
 * the length of its TTL cache. So the profile is built once per chain refresh
 * and every request inside that window reuses it; when the snapshot is
 * replaced the old entry becomes unreachable and is collected with it. No
 * timers, no eviction policy, and nothing to invalidate by hand — the cache
 * cannot outlive the data it describes.
 */

export interface GammaProfilePoint {
  strike: number;
  /** Dealer gamma from calls at this strike, in dollars per 1% move. */
  callGex: number;
  /** Dealer gamma from puts at this strike. Negative under the convention. */
  putGex: number;
  /** `callGex + putGex`. */
  netGex: number;
  oiCall: number;
  oiPut: number;
}

/** One provenance line for the block under the chart. */
export interface ProfileFact {
  label: string;
  value: string;
}

export interface GammaProfileData {
  symbol: string;
  spot: number;
  /** Backend-computed zero-gamma level, or null when the chain never crosses. */
  flipLevel: number | null;
  /** Nearest heavy strike above and below spot, by the site-wide rule. */
  magnetAbove: number | null;
  magnetBelow: number | null;
  /** Ascending by strike — lowest first, which is how the ladder is drawn. */
  points: GammaProfilePoint[];
  facts: ProfileFact[];
}

const cache = new WeakMap<PositioningData, GammaProfileData>();

export function buildGammaProfile(data: PositioningData): GammaProfileData {
  const cached = cache.get(data);
  if (cached) return cached;

  // Rows arrive highest strike first; the chart reads bottom-up.
  const points: GammaProfilePoint[] = data.rows
    .map((row) => ({
      strike: row.strike,
      callGex: row.total.callGex,
      putGex: row.total.putGex,
      netGex: row.total.gex,
      oiCall: row.total.callOi,
      oiPut: row.total.putOi,
    }))
    .sort((a, b) => a.strike - b.strike);

  const strikeGex = points.map((p) => ({ strike: p.strike, gex: p.netGex }));
  const spot = data.summary.spot;

  const expirations =
    data.expirationMeta.length > 0
      ? data.expirationMeta.map((e) => `${formatExpiryLabel(e.date)} (${e.dte}d)`).join(', ')
      : 'none resolved';

  const built: GammaProfileData = {
    symbol: data.symbol,
    spot,
    flipLevel: data.summary.flipLevel,
    magnetAbove: nearestStrongWall(strikeGex, spot, 'above')?.strike ?? null,
    magnetBelow: nearestStrongWall(strikeGex, spot, 'below')?.strike ?? null,
    points,
    facts: [
      {
        label: 'Expirations included',
        value: `${data.expirations.length} — ${expirations}`,
      },
      {
        label: 'Contracts used',
        value: `${data.meta.contractsUsed.toLocaleString('en-US')} across ${points.length} strikes`,
      },
      { label: 'Snapshot timestamp', value: data.meta.quoteDateLabel },
      {
        label: 'Open interest as of',
        value: 'The prior session’s settlement — it does not move intraday',
      },
    ],
  };

  cache.set(data, built);
  return built;
}
