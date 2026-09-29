/**
 * Shared shapes for the Macro Bias box.
 *
 * Kept apart from the fetcher and the scorer so the pure `compute` step and the
 * store can both import them without pulling in `server-only` code.
 */

/** Which way a factor is pushing, and therefore its colour. */
export type FactorDirection = 'bullish' | 'bearish' | 'neutral';

/** One of the three scored inputs: Fed, 10-year, CPI. */
export interface MacroFactor {
  /** The headline number shown big, already formatted for display. */
  value: string;
  /** The coloured sub-line under the value. */
  sub: string;
  /** +1 bullish, 0 neutral, −1 bearish. */
  score: -1 | 0 | 1;
  direction: FactorDirection;
}

/** The label the summed score maps to. */
export type BiasLabel =
  | 'Bullish'
  | 'Mild up'
  | 'Flat'
  | 'Mild down'
  | 'Bearish';

export interface MacroBias {
  /** Sum of the three factor scores, −3…+3. */
  score: number;
  label: BiasLabel;
  /** Overall tone for the Bias value's colour. */
  direction: FactorDirection;
  fed: MacroFactor;
  tenYear: MacroFactor;
  cpi: MacroFactor;
  /** One plain-language line summarising the read. */
  footer: string;
  /** ISO time the underlying FRED values were pulled. */
  at: string;
}

/** One `{date, value}` observation from a FRED series, oldest first. */
export interface FredObservation {
  date: string;
  value: number;
}
