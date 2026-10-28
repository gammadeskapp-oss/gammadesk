/**
 * Shapes for the Tastytrade / dxLink feed used by `/lab`.
 *
 * The event interfaces mirror dxFeed's FULL data format field-for-field (the
 * subset this site reads). The mock source emits exactly these objects, so the
 * aggregation that turns them into finished numbers is the same code whether
 * the events came off the websocket or out of `mock.ts`.
 */

export type TastySourceMode = 'mock' | 'live';

export interface DxQuote {
  eventType: 'Quote';
  eventSymbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  /** Epoch ms of the later of the bid/ask updates. */
  time: number;
}

export interface DxTrade {
  eventType: 'Trade';
  eventSymbol: string;
  price: number;
  size: number;
  dayVolume: number;
  time: number;
}

export interface DxGreeks {
  eventType: 'Greeks';
  eventSymbol: string;
  price: number;
  /** Implied volatility, annualised decimal. */
  volatility: number;
  delta: number;
  gamma: number;
  theta: number;
  rho: number;
  vega: number;
  time: number;
}

export interface DxSummary {
  eventType: 'Summary';
  eventSymbol: string;
  dayOpenPrice: number;
  dayHighPrice: number;
  dayLowPrice: number;
  prevDayClosePrice: number;
  openInterest: number;
}

export type DxEvent = DxQuote | DxTrade | DxGreeks | DxSummary;

/** One option contract the feed was asked for, with its dxFeed streamer symbol. */
export interface OptionRef {
  streamerSymbol: string;
  type: 'call' | 'put';
  strike: number;
  /** `YYYY-MM-DD` */
  expiration: string;
}

/** Latest event of each kind for one symbol, plus when anything last arrived. */
export interface SymbolState {
  quote?: DxQuote;
  trade?: DxTrade;
  greeks?: DxGreeks;
  summary?: DxSummary;
  /** Epoch ms this process last received any event for the symbol. */
  receivedAt: number;
}

/** Everything one reading is built from. */
export interface FeedSnapshot {
  underlying: string;
  options: OptionRef[];
  states: Map<string, SymbolState>;
}
