export interface MagnetStrike {
  strike: number;
  /** Blended, normalised pull. Positive attracts, negative repels. Range -1..1. */
  weight: number;
  /** Dollar gamma exposure at this strike, for the chart tooltip. */
  gex: number;
}

/** The magnet field belonging to one expiration. */
export interface MagnetExpiry {
  /** `YYYY-MM-DD` */
  date: string;
  label: string;
  /** Trading days from today until this expiry stops being the live one. */
  tradingDay: number;
  strikes: MagnetStrike[];
}

export interface DriftBlend {
  /** Overall tilt, -1 (bearish) to +1 (bullish). */
  score: number;
  /** Annualised drift the score maps to, e.g. 0.04 for +4%/yr. */
  annualDrift: number;
  components: Array<{
    name: string;
    score: number;
    detail: string;
  }>;
  /** Inputs that were asked for but are not available on free data. */
  unavailable: string[];
}

/** One forward step's distribution, derived from all simulated paths. */
export interface ForecastBand {
  /** Trading days forward, 1-based. */
  day: number;
  p2_5: number;
  p16: number;
  p50: number;
  p84: number;
  p97_5: number;
}

export interface HorizonOdds {
  day: number;
  label: string;
  higherPct: number;
  medianPrice: number;
}

export interface ForecastResult {
  symbol: string;
  name?: string;
  spot: number;
  /**
   * False when the symbol has no usable listed chain. The cone is then driven
   * by price and volatility alone, with no positioning shaping it — which the
   * UI must say plainly rather than presenting an identical-looking chart.
   */
  hasOptions: boolean;
  /** Why options are missing, when they are. */
  optionsNote: string | null;
  /** Annualised realised volatility used for the steps. */
  volatility: number;
  drift: DriftBlend;
  paths: number;
  horizon: number;
  bands: ForecastBand[];
  odds: HorizonOdds[];
  /** Share of paths that traded 8% or more below spot at any point. */
  crashPct: number;
  crashThresholdPct: number;
  magnets: MagnetExpiry[];
  /** Last 90 sessions of real closes, for the left half of the chart. */
  history: Array<{ date: string; close: number }>;
  /** Null without options data — there is no dealer gamma to have a regime. */
  regime: 'positive' | 'negative' | null;
  netGex: number | null;
  gammaFlip: number | null;
  asOfLabel: string;
  quoteDateLabel: string;
  /**
   * ISO quote date of the chain, when there was one.
   *
   * Null on the prices-only path, where there is no option chain to be stale
   * about — the staleness guard treats that as "nothing to check" rather than
   * as a failure, which is why this is nullable and the label above is not.
   */
  quoteDateIso: string | null;
  source: string;
  cacheSeconds: number;
  /** Non-fatal caveats worth showing. */
  notes: string[];
}
