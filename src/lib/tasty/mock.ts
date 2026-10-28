import type { DxGreeks, DxQuote, DxSummary, DxTrade, FeedSnapshot, OptionRef, SymbolState } from './types';

/**
 * A synthetic feed in exactly the shape dxLink delivers, for building and
 * testing `/lab` before a Tastytrade account is approved.
 *
 * ## Nothing here is market data
 *
 * Every number is generated. The spot is a fixed anchor (or a reference close
 * the caller passes), wobbled by the clock so the "as of" stamp has something
 * to move; open interest is a seeded bell curve with round-strike bumps; gamma
 * is a textbook normal-density shape so the profile looks like a chain. The UI
 * labels every reading from this file `MOCK — not live`, and nothing reads it
 * unless `TASTY_SOURCE` is unset or `mock`.
 *
 * Gamma is generated here, not computed by the aggregation — the aggregation
 * only ever reads the `gamma` field off a Greeks event, mocked or real.
 */

const ANCHORS: Record<string, number> = {
  SPY: 672,
  QQQ: 604,
  IWM: 246,
  DIA: 468,
  AAPL: 258,
  NVDA: 182,
  TSLA: 438,
  MSFT: 521,
  AMD: 236,
};

const INDEX_ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA']);

/** mulberry32 — small deterministic PRNG so a mock reading is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Next `count` weekday expirations from `now`, then the next three Fridays after them. */
export function mockExpirations(now: number, count = 4): string[] {
  const out: string[] = [];
  const day = 86_400_000;
  let t = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  while (out.length < count) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(isoDate(t));
    t += day;
  }
  let fridays = 0;
  while (fridays < 3) {
    if (new Date(t).getUTCDay() === 5) {
      out.push(isoDate(t));
      fridays += 1;
    }
    t += day;
  }
  return out;
}

export function strikeStep(symbol: string, spot: number): number {
  if (INDEX_ETFS.has(symbol)) return 1;
  if (spot < 30) return 0.5;
  if (spot < 200) return 1;
  if (spot < 1000) return 5;
  return 10;
}

/** dxFeed option streamer symbol, e.g. `.SPY261023C672`. */
export function streamerSymbol(underlying: string, expiration: string, type: 'call' | 'put', strike: number): string {
  const ymd = expiration.slice(2).replaceAll('-', '');
  return `.${underlying}${ymd}${type === 'call' ? 'C' : 'P'}${strike}`;
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Build a complete mock snapshot for `underlying`.
 *
 * `referencePrice`, when given (e.g. the last close another source already
 * fetched), anchors the mock spot so the page is not visibly absurd; it is
 * still a mock reading and is labelled as one.
 */
export function mockSnapshot(underlying: string, now: number = Date.now(), referencePrice?: number | null): FeedSnapshot {
  const symbol = underlying.toUpperCase();
  // A real reference price wins, so mock levels sit where the real chart is.
  const anchor =
    referencePrice && referencePrice > 0 ? referencePrice : (ANCHORS[symbol] ?? 50 + (hash(symbol) % 400));
  // A slow wobble on the clock: ±0.35% over ~17 minutes, so successive views differ.
  const spot = Number((anchor * (1 + 0.0035 * Math.sin(now / 160_000))).toFixed(2));
  const step = strikeStep(symbol, anchor);
  const baseIv = INDEX_ETFS.has(symbol) ? 0.15 : 0.34;
  const oiScale = INDEX_ETFS.has(symbol) ? 9000 : 2200;
  const random = rng(hash(`${symbol}:${isoDate(now)}`));

  const states = new Map<string, SymbolState>();
  const half = Math.max(0.01, spot * 0.0002);
  const quote: DxQuote = {
    eventType: 'Quote',
    eventSymbol: symbol,
    bidPrice: Number((spot - half).toFixed(2)),
    askPrice: Number((spot + half).toFixed(2)),
    bidSize: 300,
    askSize: 300,
    time: now,
  };
  const trade: DxTrade = { eventType: 'Trade', eventSymbol: symbol, price: spot, size: 100, dayVolume: 41_000_000, time: now };
  states.set(symbol, { quote, trade, receivedAt: now });

  const options: OptionRef[] = [];
  const centre = Math.round(anchor / step) * step;
  const span = Math.max(8, Math.round((anchor * 0.07) / step));
  const expirations = mockExpirations(now);

  expirations.forEach((expiration, index) => {
    const T = Math.max(0.5 / 365, (Date.parse(`${expiration}T20:00:00Z`) - now) / (365 * 86_400_000));
    const front = 1 / (1 + index * 0.45);
    for (let i = -span; i <= span; i++) {
      const strike = Number((centre + i * step).toFixed(2));
      if (strike <= 0) continue;
      const moneyness = (strike - spot) / spot;
      const iv = Math.max(0.05, baseIv * (1 - 0.9 * moneyness) + 0.01 * random());
      const d1 = (Math.log(spot / strike) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
      const gamma = normPdf(d1) / (spot * iv * Math.sqrt(T));

      const bell = Math.exp(-((moneyness / 0.035) ** 2));
      const round = strike % (step * 10) === 0 ? 3.2 : strike % (step * 5) === 0 ? 1.9 : 1;
      for (const type of ['call', 'put'] as const) {
        // Calls stack above spot and puts below, as on a real index chain.
        const tilt = type === 'call' ? (moneyness > 0 ? 1.7 : 0.8) : moneyness < 0 ? 1.15 : 0.35;
        const oi = Math.round(oiScale * front * bell * round * tilt * (0.55 + random()));
        const sym = streamerSymbol(symbol, expiration, type, strike);
        options.push({ streamerSymbol: sym, type, strike, expiration });
        const greeks: DxGreeks = {
          eventType: 'Greeks',
          eventSymbol: sym,
          price: 0,
          volatility: Number(iv.toFixed(4)),
          delta: 0,
          gamma: Number(gamma.toPrecision(6)),
          theta: 0,
          rho: 0,
          vega: 0,
          time: now,
        };
        const summary: DxSummary = {
          eventType: 'Summary',
          eventSymbol: sym,
          dayOpenPrice: Number.NaN,
          dayHighPrice: Number.NaN,
          dayLowPrice: Number.NaN,
          prevDayClosePrice: Number.NaN,
          openInterest: oi,
        };
        // Today's volume: a share of the open interest, heavier in the front week.
        const optionTrade: DxTrade = {
          eventType: 'Trade',
          eventSymbol: sym,
          price: 0,
          size: 1,
          dayVolume: Math.round(oi * front * (0.1 + 0.5 * random())),
          time: now,
        };
        states.set(sym, { greeks, summary, trade: optionTrade, receivedAt: now });
      }
    }
  });

  return { underlying: symbol, options, states };
}
