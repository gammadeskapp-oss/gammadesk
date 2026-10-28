import { MIN_T } from '../blackScholes';
import { isExpired, yearsToExpiry } from '../time';
import type { NormalisedContract } from '../types';
import type { FeedSnapshot, SymbolState } from './types';

/**
 * Feed events → the public model's inputs. Pure; no I/O.
 *
 * ## No formula lives here
 *
 * `/lab` used to carry its own gamma proxy (`gamma × OI × 100 × spot`, net =
 * call − put, per $1 move). It does not any more: the feed is turned into the
 * same `NormalisedContract[]` the Cboe and Polygon adapters produce, and
 * `buildPositioning` in `lib/exposure.ts` — the code behind `/decision` and
 * `/dashboard` — does all of the arithmetic. Same dealer sign (long calls,
 * short puts), same unit (dollars of delta per 1% move), same flip search
 * (re-pricing the book across ±15% of spot), same strike and expiration scope.
 * A number on `/lab` and the same strike on a public page differ only by their
 * inputs: live Tastytrade versus delayed chain data.
 *
 * ## What is taken from the feed
 *
 * - IV from the Greeks event's `volatility`, which is the input the public
 *   greek is computed from — the public model prices gamma (and vanna, charm)
 *   from an IV via Black-Scholes, and so does this path. The feed's own
 *   `gamma` field is dxFeed's output from that same IV, so it is not fed in a
 *   second time: doing so would make `/lab` a different formula again.
 * - Open interest from the Summary event.
 * - Spot from the underlying's quote mid (see `spotFrom`).
 *
 * A contract missing either IV or OI is left out rather than zeroed, the same
 * rule the public adapters apply to a contract with nothing usable on it.
 */

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Mid of the underlying quote, falling back to the last trade. */
export function spotFrom(state: SymbolState | undefined): number | null {
  if (!state) return null;
  const q = state.quote;
  if (q && finite(q.bidPrice) && finite(q.askPrice) && q.bidPrice > 0 && q.askPrice >= q.bidPrice) {
    return (q.bidPrice + q.askPrice) / 2;
  }
  if (state.trade && finite(state.trade.price) && state.trade.price > 0) return state.trade.price;
  return null;
}

/**
 * Every subscribed option with a usable IV and open interest, as the public
 * model's contract shape. Volume is the option's own `dayVolume` when a Trade
 * event has arrived for it, else 0, as the public adapters report it.
 */
export function feedContracts(snapshot: FeedSnapshot, now: Date = new Date()): NormalisedContract[] {
  const out: NormalisedContract[] = [];
  for (const ref of snapshot.options) {
    const state = snapshot.states.get(ref.streamerSymbol);
    const iv = state?.greeks?.volatility;
    const oi = state?.summary?.openInterest;
    if (!finite(iv) || iv <= 0 || !finite(oi) || oi < 0) continue;
    if (isExpired(ref.expiration, now)) continue;
    const T = yearsToExpiry(ref.expiration, now);
    const volume = state?.trade?.dayVolume;
    out.push({
      ticker: ref.streamerSymbol,
      type: ref.type,
      strike: ref.strike,
      expiration: ref.expiration,
      openInterest: oi,
      volume: finite(volume) && volume > 0 ? volume : 0,
      iv,
      ivSource: 'quoted',
      T: Math.max(T, MIN_T),
    });
  }
  return out;
}
