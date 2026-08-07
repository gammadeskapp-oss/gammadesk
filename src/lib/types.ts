export type OptionType = 'call' | 'put';

export type MetricKey = 'gex' | 'vex' | 'cex' | 'oi';

/** Where the implied vol used for a contract came from. */
export type IvSource = 'api' | 'solved' | 'model';

/** One options contract, normalised out of whatever Polygon returned. */
export interface NormalisedContract {
  ticker: string;
  type: OptionType;
  strike: number;
  /** `YYYY-MM-DD` */
  expiration: string;
  openInterest: number;
  iv: number;
  ivSource: IvSource;
  /** Years to expiry, already floored at MIN_T. */
  T: number;
}

/** The four aggregated numbers held in every table cell. */
export interface Metrics {
  /** Dealer gamma exposure, in dollars of delta per 1% move in spot. */
  gex: number;
  /** Dealer vanna exposure, in dollars of delta per 1 vol point of IV. */
  vex: number;
  /** Dealer charm exposure, in dollars of delta per calendar day. */
  cex: number;
  /** Net open interest, calls minus puts, in contracts. */
  oi: number;
  /** Call-side open interest, in contracts. */
  callOi: number;
  /** Put-side open interest, in contracts. */
  putOi: number;
}

export interface StrikeRow {
  strike: number;
  /** One entry per expiration, in the same order as `expirations`. */
  cells: Metrics[];
  total: Metrics;
}

export interface Summary {
  spot: number;
  netGex: number;
  /** `positive` = dealers dampen moves, `negative` = dealers amplify them. */
  regime: 'positive' | 'negative';
  /** Spot level at which net dealer gamma crosses zero, or null if none found. */
  flipLevel: number | null;
  magnetAbove: { strike: number; gex: number } | null;
  magnetBelow: { strike: number; gex: number } | null;
  totalCallOi: number;
  totalPutOi: number;
  putCallOiRatio: number | null;
}

export interface DataMeta {
  source: 'polygon' | 'sample';
  /** Server-rendered "data as of" string, e.g. `Aug 06, 2026, 16:00 ET`. */
  asOfLabel: string;
  asOfIso: string;
  /** Timestamp the underlying market data itself refers to. */
  quoteDateLabel: string;
  cacheSeconds: number;
  polygonRequests: number;
  contractsUsed: number;
  ivSources: Record<IvSource, number>;
  riskFreeRate: number;
  dividendYield: number;
  /** Non-fatal warnings worth surfacing in the UI. */
  notes: string[];
}

export interface ExpirationMeta {
  /** `YYYY-MM-DD` */
  date: string;
  /** Compact column header, e.g. `AUG 07`. */
  label: string;
  /** Whole calendar days to expiry, computed on the server so SSR and
   *  hydration can never disagree. */
  dte: number;
}

export interface PositioningData {
  symbol: string;
  spot: number;
  expirations: string[];
  expirationMeta: ExpirationMeta[];
  rows: StrikeRow[];
  /** Column totals, one per expiration, plus `grandTotal`. */
  columnTotals: Metrics[];
  grandTotal: Metrics;
  summary: Summary;
  meta: DataMeta;
}

export interface PositioningError {
  error: string;
  detail?: string;
}
