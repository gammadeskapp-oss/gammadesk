/**
 * How much to trust the dealer-sign assumption for a given underlying.
 *
 * Every number on the positioning page rests on one assumption, made in
 * `exposure.ts`: customers buy puts and sell calls, so the dealer on the other
 * side is long calls and short puts. That is a reasonable description of the
 * index and large-cap books, where the flow is dominated by institutional
 * hedging and covered-call overwriting.
 *
 * It is not a law. On heavily retail-traded single names the dominant customer
 * flow is *buying* calls, which puts the dealer short calls rather than long
 * them — the sign flips, and with it the regime, the flip level, and which side
 * of a wall price is supposed to bounce off. The engine has no way to detect
 * that from open interest alone, so the honest response is to say so on the
 * page rather than to quietly present an inverted book as fact.
 *
 * Deliberately pure and dependency-free: the caveat is rendered inside the
 * client-side dashboard, and it is not worth a directory lookup or a network
 * round trip to decide whether to show a warning.
 */

/**
 * Underlyings whose books the convention describes well.
 *
 * Broad-market and sector baskets only — index ETFs, their index roots, and the
 * sector SPDRs. A basket has no retail single-name call-buying frenzy to invert
 * it, because there is no single company for the crowd to be excited about.
 *
 * Everything not on this list is treated as a single stock and gets the caveat,
 * which is the cautious way round: a missing ticker costs a warning that was
 * not strictly needed, while a wrongly-omitted warning costs the reader.
 */
const BROAD_MARKET = new Set([
  // Index ETFs
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'IVV', 'MDY', 'RSP', 'QQQM',
  // International and rates baskets
  'EFA', 'EEM', 'IEFA', 'IEMG', 'TLT', 'IEF', 'HYG', 'LQD',
  // Cash index roots, as Cboe files them
  'SPX', 'SPXW', 'NDX', 'RUT', 'XSP', 'OEX', 'DJX', 'VIX', 'VIXW',
  // Sector SPDRs
  'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY',
]);

/** True when the underlying is a basket rather than one company. */
export function isBroadMarket(symbol: string): boolean {
  return BROAD_MARKET.has(symbol.trim().toUpperCase());
}

/**
 * The plain-English caveat for a single-stock view, or null when the symbol is
 * a basket and the convention holds.
 *
 * Returned as text rather than rendered here so the same wording can appear in
 * a panel, a tooltip, or the JSON API without being retyped.
 */
export function dealerConventionCaveat(symbol: string): string | null {
  if (isBroadMarket(symbol)) return null;
  return (
    `On individual stocks — especially popular retail names — these dealer ` +
    `levels are less reliable than on SPY/QQQ. Read them as a rough guide, ` +
    `not gospel.`
  );
}
