import { MIN_T } from './blackScholes';
import { addDays, marketToday, yearsToExpiry } from './time';
import { modelIv } from './volSurface';
import type { NormalisedContract } from './types';

/**
 * Deterministic sample chain, used when no API key is configured or when a
 * Polygon call fails. It exists so the dashboard is inspectable — and
 * deployable — without burning free-plan requests.
 *
 * It is ALWAYS labelled "SAMPLE DATA" in the UI. Nothing here is market data.
 */

/** Mulberry32 — small, fast, and stable across runs so the table never flickers. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Next `count` weekdays on or after `from`, as `YYYY-MM-DD`. */
function nextExpirations(from: string, count: number): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; out.length < count && i < 40; i += 1) {
    const [y, m, d] = cursor.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (day !== 0 && day !== 6 && yearsToExpiry(cursor) > MIN_T) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export interface DemoSnapshot {
  spot: number;
  quoteDate: Date;
  contracts: NormalisedContract[];
}

export function buildDemoChain(strikesEachSide: number, expirationCount: number): DemoSnapshot {
  const spot = 612.43;
  const rand = seededRandom(0x9e3779b9);
  const expirations = nextExpirations(marketToday(), expirationCount);
  const contracts: NormalisedContract[] = [];

  const baseStrike = Math.round(spot);

  for (let offset = -strikesEachSide - 2; offset <= strikesEachSide + 2; offset += 1) {
    const strike = baseStrike + offset;
    const distance = Math.abs(strike - spot);

    // Open interest clusters at the money and spikes on round numbers.
    const atmWeight = Math.exp(-((distance / 11) ** 2));
    const roundBonus =
      strike % 25 === 0 ? 3.1 : strike % 10 === 0 ? 2.0 : strike % 5 === 0 ? 1.45 : 1;

    for (const [index, expiration] of expirations.entries()) {
      const T = Math.max(yearsToExpiry(expiration), MIN_T);
      // Front expirations carry the most open interest.
      const termWeight = 1 / (1 + index * 0.55);

      for (const type of ['call', 'put'] as const) {
        // Puts skew below spot, calls above — the usual index footprint.
        const sideWeight =
          type === 'put'
            ? strike <= spot
              ? 1.35
              : 0.6
            : strike >= spot
              ? 1.2
              : 0.55;

        const noise = 0.55 + rand() * 0.95;
        const openInterest = Math.round(
          26_000 * atmWeight * roundBonus * termWeight * sideWeight * noise,
        );
        if (openInterest < 25) continue;

        contracts.push({
          ticker: `DEMO:${expiration}:${type === 'call' ? 'C' : 'P'}${strike}`,
          type,
          strike,
          expiration,
          openInterest,
          iv: modelIv(spot, strike, T) * (0.94 + rand() * 0.12),
          ivSource: 'model' as const,
          T,
        });
      }
    }
  }

  return { spot, quoteDate: new Date(), contracts };
}
