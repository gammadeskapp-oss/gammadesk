/**
 * Shapes for the first-class Macro Bias card — the −5…+5 model the redesign's
 * Home dashboard renders under the hero.
 *
 * Kept apart from the legacy 3-factor `MacroBias` (Fed / 10Y / CPI), which the
 * old ContextRow still reads: this is a wider read — rates, dollar, volatility,
 * breadth, credit, plus an event-risk flag — scored on a −5…+5 scale, with a
 * confidence that is independent of direction and a persisted daily history.
 *
 * Pure types, free of `server-only`, so the scorer and its verify script can
 * import them without pulling in the store.
 */

/** Which way a driver is pushing risk assets. */
export type DriverState = 'headwind' | 'neutral' | 'tailwind';

/** One scored macro input. */
export interface RichMacroDriver {
  /** Stable key, e.g. `rates`, `dollar`, `vol`, `breadth`, `credit`, `event`. */
  key: string;
  label: string;
  /** Headline reading, formatted for display. */
  value: string;
  /** One clause on what the driver is doing. */
  sub: string;
  /** +1 tailwind, 0 neutral, −1 headwind. */
  score: -1 | 0 | 1;
  state: DriverState;
}

export type RichBiasDirection = 'bullish' | 'bearish' | 'neutral';

/** The label the −5…+5 score maps to. */
export type RichBiasLabel =
  | 'Bullish'
  | 'Cautiously bullish'
  | 'Neutral'
  | 'Cautiously bearish'
  | 'Bearish';

export interface RichMacroBias {
  /** Sum of the driver scores, clamped to −5…+5. */
  score: number;
  label: RichBiasLabel;
  direction: RichBiasDirection;
  /** 0–100, how one-sided the non-neutral drivers are. Separate from direction. */
  confidence: number;
  drivers: RichMacroDriver[];
  /** One plain-language line summarising the backdrop. */
  reason: string;
  /** What flipped versus the previously stored reading, set at refresh time. */
  changed: string;
  /** The next scheduled catalyst's label, stored so history entries can name it. */
  nextEventLabel: string;
  /** ISO time the record was computed. */
  at: string;
  /** New York trading date this record belongs to, `YYYY-MM-DD`. */
  dateKey: string;
}

/** One stored past day, newest first in the doc. */
export interface RichMacroHistoryEntry {
  /** New York date, `YYYY-MM-DD`. */
  date: string;
  score: number;
  label: RichBiasLabel;
  /** What flipped versus the day before, or a "no change" line. */
  changed: string;
  /** The catalyst that was next as of that day. */
  nextEvent: string;
}
