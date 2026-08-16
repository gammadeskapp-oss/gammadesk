import { dealerConventionCaveat } from '@/lib/dealerConvention';

/**
 * The single-stock health warning.
 *
 * Renders nothing for baskets, so it can be dropped in unconditionally next to
 * any positioning view and will only speak when it has something to say.
 *
 * Amber — the same `flip` colour every other caveat on the site uses — rather
 * than red: the numbers are not wrong, they are less load-bearing. Placed above
 * the read itself, because a caveat underneath a confident-looking headline is
 * a caveat most people never reach.
 */
export function DealerConventionNote({ symbol }: { symbol: string }) {
  const caveat = dealerConventionCaveat(symbol);
  if (!caveat) return null;

  return (
    <section
      aria-label={`How far to trust the ${symbol} dealer levels`}
      className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed"
    >
      <p className="text-flip">
        <span className="font-bold">Single stock — read these loosely. </span>
        {caveat}
      </p>
      <p className="mt-2 text-term-dim">
        Everything here assumes customers buy puts and sell calls, leaving
        dealers long calls and short puts. That describes the index and
        large-cap books well. On a name the crowd is busy buying calls in, the
        dealer is short those calls instead — which flips the sign of the whole
        book, and with it the regime, the flip level, and which way price is
        supposed to react at a wall. Open interest alone cannot tell the two
        apart, so this page cannot detect it for you.
      </p>
    </section>
  );
}
