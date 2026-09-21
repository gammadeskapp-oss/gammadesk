/**
 * The little pipe-delimited code that the "Copy for TradingView" button hands
 * to the GammaDesk Levels Pine indicator (`/tradingview/gammadesk-levels.pine`).
 *
 * Format: `SYMBOL|FLOOR|CEILING|FLIP`, e.g. `SPY|760|765|763.21`.
 *
 * Kept pure and free of `server-only` so both the page and
 * `scripts/verify-tradingview.mjs` can use it, and so the one place that
 * decides the format is the one place the Pine script has to agree with.
 */

export interface LevelCodeInput {
  symbol: string;
  floor: number | null;
  ceiling: number | null;
  flip: number | null;
}

export interface ParsedLevelCode {
  symbol: string;
  floor: number;
  ceiling: number;
  flip: number;
}

/** The field separator. A pipe never appears in a ticker or a price. */
export const CODE_SEPARATOR = '|';

/**
 * Format a price for the code: up to two decimals, with trailing zeros trimmed
 * so a round strike reads `765` rather than `765.00`, while a flip keeps its
 * `763.21`. The Pine side parses with `str.tonumber`, which is happy with both.
 */
function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Build today's code, or null when the map is missing a level.
 *
 * All three levels are required: the Pine indicator draws floor, ceiling and
 * flip, and a code with a gap would either fail to parse or draw a partial
 * picture. When any is absent — a name with no clear magnet, say — the button
 * simply does not show, which is better than copying something broken.
 */
export function buildLevelCode(input: LevelCodeInput): string | null {
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(symbol)) return null;

  const { floor, ceiling, flip } = input;
  for (const value of [floor, ceiling, flip]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  }

  return [symbol, formatNumber(floor!), formatNumber(ceiling!), formatNumber(flip!)].join(CODE_SEPARATOR);
}

/**
 * Parse a code back into its parts, or null when it is not a well-formed code.
 * The inverse of `buildLevelCode`; exists mainly so the round-trip can be
 * tested and so any future importer of a pasted code has one validator.
 */
export function parseLevelCode(raw: string): ParsedLevelCode | null {
  const parts = raw.trim().split(CODE_SEPARATOR);
  if (parts.length !== 4) return null;

  const symbol = parts[0].trim().toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(symbol)) return null;

  const nums = parts.slice(1).map((p) => Number(p.trim()));
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;

  const [floor, ceiling, flip] = nums;
  return { symbol, floor, ceiling, flip };
}
