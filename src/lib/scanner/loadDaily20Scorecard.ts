import 'server-only';

import { barStore } from '../rs/refresh';
import { SHARDS } from '../rs/universe';
import { peekDaily20Listings } from './daily20Snapshots';
import {
  computeScorecard,
  HORIZONS,
  type Horizon,
  type ScoredListing,
  type Scorecard,
} from './daily20Scorecard';

/**
 * Price each stored Daily 20 listing from the RS bars and compute the
 * scorecard.
 *
 * Forward returns are close-to-close at 1/5/10/20 trading sessions from the
 * listing date; MFE/MAE are the best and worst close inside the longest window,
 * relative to the listing-day close. A session with no bar yet (the window has
 * not matured) scores that horizon null, so the scorecard only ever reports
 * what has actually had time to happen.
 *
 * Sector is not carried on a listing row, so the by-sector breakdown is empty
 * until that is stored — flagged rather than faked.
 */

/** symbol -> { date -> index } and its aligned closes, merged across shards. */
interface PriceSeries {
  index: Map<string, number>;
  closes: (number | null)[];
}

async function loadPriceSeries(): Promise<Map<string, PriceSeries>> {
  const shards = await Promise.all(
    Array.from({ length: SHARDS }, (_, s) => barStore(s).read().catch(() => null)),
  );
  const out = new Map<string, PriceSeries>();
  for (const shard of shards) {
    if (!shard) continue;
    const index = new Map<string, number>();
    shard.dates.forEach((d, i) => index.set(d, i));
    for (const [symbol, closes] of Object.entries(shard.closes)) {
      // A symbol lives in one shard; first writer wins if a stale shard overlaps.
      if (!out.has(symbol)) out.set(symbol, { index, closes });
    }
  }
  return out;
}

function priceListing(
  row: {
    date: string;
    symbol: string;
    direction: ScoredListing['direction'];
    setup: ScoredListing['setup'];
    regime: ScoredListing['regime'];
    extended: boolean;
    newEntry: boolean;
    sector: string | null;
  },
  series: PriceSeries | undefined,
): ScoredListing | null {
  const ret = { 1: null, 5: null, 10: null, 20: null } as Record<Horizon, number | null>;
  if (!series) return { ...row, ret, mfe: null, mae: null };

  const i = series.index.get(row.date);
  const entry = i === undefined ? null : series.closes[i];
  if (i === undefined || entry === null || !(entry > 0)) {
    return { ...row, ret, mfe: null, mae: null };
  }

  for (const h of HORIZONS) {
    const c = series.closes[i + h];
    ret[h] = c != null && c > 0 ? (c - entry) / entry : null;
  }

  // MFE / MAE over the longest window, from the closes that exist.
  let best = entry;
  let worst = entry;
  for (let j = i + 1; j <= i + HORIZONS[HORIZONS.length - 1] && j < series.closes.length; j += 1) {
    const c = series.closes[j];
    if (c == null || !(c > 0)) continue;
    if (c > best) best = c;
    if (c < worst) worst = c;
  }
  const matured = HORIZONS.some((h) => ret[h] !== null);

  return {
    ...row,
    ret,
    mfe: matured ? (best - entry) / entry : null,
    mae: matured ? (worst - entry) / entry : null,
  };
}

export async function loadDaily20Scorecard(): Promise<Scorecard> {
  const [{ rows }, series] = await Promise.all([peekDaily20Listings(), loadPriceSeries()]);
  const scored = rows
    .map((r) => priceListing(r, series.get(r.symbol)))
    .filter((l): l is ScoredListing => l !== null);
  return computeScorecard(scored);
}
