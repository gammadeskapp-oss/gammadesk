import 'server-only';

import { fetchBars } from '../rs/history';
import type { CloseSeries } from './sessions';

/**
 * Daily closes for the handful of symbols the track record needs.
 *
 * ## Why this fetches rather than reading the stored bars
 *
 * The relative-strength bar shards hold every close this site has, and reading
 * them would cost nothing. They are refreshed a shard a night, though, which
 * means on any given evening three quarters of the index is up to four days
 * behind — and both jobs here run within twenty minutes of the closing bell
 * and need *today's* close. A record that filled in a forward return from a
 * three-day-old bar would be writing the wrong number under the right heading,
 * permanently and silently.
 *
 * The cost is bounded and small: five symbols on the logging pass, and on the
 * settling pass only the symbols with an unfilled horizon inside the chase
 * window. It is the same Yahoo daily endpoint the nightly refresh uses, with
 * the same split handling — see `rs/history.ts`. Reusing it is deliberate: a
 * second price source would eventually disagree with the first about a split,
 * and the disagreement would land in the one table on this site whose entire
 * purpose is to be trustworthy.
 *
 * The arithmetic that reads a horizon out of the returned series is in
 * `sessions.ts`, which is pure and therefore checkable.
 */

/** How much history to ask for. Half a year covers the chase window easily. */
const YEARS = 0.5;

export { closeAfter, closeOn } from './sessions';
export type { CloseSeries } from './sessions';

/**
 * One symbol's recent closes, or null when the symbol has no history at all.
 *
 * Throws are left to the caller: a request that failed and a symbol that does
 * not exist need different handling, and collapsing them would let an outage
 * write "no data" into a permanent record.
 */
export async function readCloses(symbol: string): Promise<CloseSeries | null> {
  const bars = await fetchBars(symbol, YEARS);
  if (!bars || bars.length === 0) return null;

  return {
    dates: bars.map((bar) => bar.date),
    closes: bars.map((bar) => bar.close),
  };
}
