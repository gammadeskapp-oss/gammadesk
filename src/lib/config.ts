/**
 * Central place for every tunable. All of these are read from `process.env`
 * on the server only — none of them are `NEXT_PUBLIC_`, so the API key can
 * never be inlined into the client bundle.
 */

import 'server-only';

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type DemoMode = 'auto' | 'always' | 'never';

function demoMode(): DemoMode {
  const raw = (process.env.GAMMADESK_DEMO ?? 'auto').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'always') return 'always';
  if (raw === '0' || raw === 'false' || raw === 'never') return 'never';
  return 'auto';
}

export const config = {
  get apiKey(): string | undefined {
    const key = process.env.POLYGON_API_KEY?.trim();
    return key && key !== 'your_polygon_key_here' ? key : undefined;
  },
  get symbol(): string {
    return (process.env.GAMMADESK_SYMBOL ?? 'SPY').trim().toUpperCase();
  },
  get cacheSeconds(): number {
    // Floor of 5 minutes: anything shorter risks blowing the free-plan quota.
    return Math.max(300, num(process.env.GAMMADESK_CACHE_SECONDS, 1800));
  },
  get expirationCount(): number {
    return Math.min(12, Math.max(1, num(process.env.GAMMADESK_EXPIRATIONS, 5)));
  },
  get strikesEachSide(): number {
    return Math.min(80, Math.max(5, num(process.env.GAMMADESK_STRIKES_EACH_SIDE, 30)));
  },
  get riskFreeRate(): number {
    return num(process.env.GAMMADESK_RISK_FREE_RATE, 0.043);
  },
  get dividendYield(): number {
    return num(process.env.GAMMADESK_DIVIDEND_YIELD, 0.012);
  },
  get demoMode(): DemoMode {
    return demoMode();
  },
} as const;

/**
 * Free-plan budget. One full refresh must fit inside a single minute's quota:
 * 1 previous-close call + up to 4 pages of the options-chain snapshot.
 */
export const POLYGON_LIMITS = {
  requestsPerMinute: 5,
  maxSnapshotPages: 4,
  pageSize: 250,
  /** Calendar-day horizon requested from the API when picking expirations. */
  expiryHorizonDays: 16,
} as const;
