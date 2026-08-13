import { formatContracts, formatUsd } from './format';
import type { Metrics, MetricKey } from './types';

export interface MetricDef {
  key: MetricKey;
  /** Tab label. */
  tab: string;
  /** Full name for the header line. */
  name: string;
  /** What one unit of this number means. */
  unit: string;
  /** Pull the value out of an aggregated cell. */
  read: (m: Metrics) => number;
  /** Render a cell value. */
  format: (value: number) => string;
  /** Plain-language explanation for the "What am I looking at?" panel. */
  plain: {
    what: string;
    positive: string;
    negative: string;
    why: string;
  };
}

export const METRICS: Record<MetricKey, MetricDef> = {
  gex: {
    key: 'gex',
    tab: 'GEX',
    name: 'Gamma Exposure',
    unit: '$ of dealer delta per +1% move in spot',
    read: (m) => m.gex,
    format: formatUsd,
    plain: {
      what:
        'Gamma measures how fast a dealer’s hedge has to change when the price moves. GEX adds that up across every contract at a strike, assuming dealers are long calls and short puts.',
      positive:
        'Amber (positive) means dealers get longer as price falls and shorter as it rises — so their hedging pushes back against the move. Expect price to stick, chop, and mean-revert around these strikes.',
      negative:
        'Blue (negative) means dealers sell as price falls and buy as it rises — their hedging adds fuel to the move. Expect faster, trendier, more volatile price action here.',
      why:
        'Big amber strikes act like magnets that pin price. Big blue strikes act like accelerators once price gets there.',
    },
  },
  vex: {
    key: 'vex',
    tab: 'VEX',
    name: 'Vanna Exposure',
    unit: '$ of dealer delta per +1 volatility point',
    read: (m) => m.vex,
    format: formatUsd,
    plain: {
      what:
        'Vanna measures how a dealer’s hedge changes when implied volatility changes, even if the price does not move at all. VEX totals that across the strikes.',
      positive:
        'Amber means that if volatility rises, dealers end up needing to buy. Falling volatility makes them sell.',
      negative:
        'Blue means the opposite: rising volatility forces dealers to sell, and falling volatility forces them to buy.',
      why:
        'This is why markets often drift upward as the VIX bleeds lower on quiet days — dealers are mechanically buying because volatility fell, not because anyone is bullish.',
    },
  },
  cex: {
    key: 'cex',
    tab: 'CEX',
    name: 'Charm Exposure',
    unit: '$ of dealer delta per calendar day of decay',
    read: (m) => m.cex,
    format: formatUsd,
    plain: {
      what:
        'Charm measures how a dealer’s hedge changes purely because time passes and options get closer to expiry. CEX totals that per day.',
      positive:
        'Amber means the simple passage of time pushes dealers to buy the underlying.',
      negative:
        'Blue means time passing pushes dealers to sell.',
      why:
        'Charm is the reason for the classic drift into a big expiration, and the reason positioning can unwind sharply in the days right after one. It builds up quietly and shows up as flows nobody announced.',
    },
  },
  oi: {
    key: 'oi',
    tab: 'OI',
    name: 'Net Open Interest',
    unit: 'contracts, calls minus puts',
    read: (m) => m.oi,
    format: formatContracts,
    plain: {
      what:
        'Open interest is simply how many contracts are currently open at that strike. This tab shows the net: call open interest minus put open interest.',
      positive:
        'Amber means more calls than puts are open at that strike — the crowd is positioned for upside there, often a target or a place people sell covered calls.',
      negative:
        'Blue means more puts than calls are open — usually hedges and downside protection clustered at that level.',
      why:
        'This is the raw, no-maths view of where the crowd actually is. The other three tabs are all built on top of these same numbers.',
    },
  },
};

export const METRIC_ORDER: MetricKey[] = ['gex', 'vex', 'cex', 'oi'];
