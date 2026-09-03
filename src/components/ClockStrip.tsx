import type { LiveOverlay } from '@/lib/live/types';

/**
 * Says which clock the prices on a page are on, and what that leaves mixed.
 *
 * ## Rendered in both states, deliberately
 *
 * A strip that only appears when prices are live teaches a reader to read its
 * absence as nothing in particular, and the absence is the production state —
 * the one that is true almost always. So "these are stored closes" gets the
 * same line as "these are live", and the reason is printed either way.
 *
 * ## Naming the mixture is the point, not the badge
 *
 * A live price on its own is easy to label. What needs saying is what did
 * *not* move with it: a page swapping in a current quote while every level,
 * ranking and count around it stays as stored is showing two measurements
 * taken at two different times in the same row. `mixedNote` is where each page
 * says which of its own numbers that applies to, because it differs per page
 * and a generic sentence would be true and useless.
 *
 * This is a server component with no state: it renders text.
 */
export function ClockStrip({
  live,
  mixedNote,
}: {
  live: LiveOverlay;
  /** What stayed stored while the price went live, in this page's own terms. */
  mixedNote: string;
}) {
  const label = !live.available ? 'STORED' : live.marketOpen ? 'LIVE' : 'LAST PRINT';

  return (
    <div className="panel flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5 text-2xs leading-relaxed">
      <span
        className={`shrink-0 border px-1.5 py-0.5 font-bold tracking-[0.1em] ${
          live.available ? 'border-pos/50 text-pos' : 'border-term-line text-term-faint'
        }`}
      >
        {label}
      </span>

      {live.available ? (
        <span className="text-term-dim">
          Prices read at{' '}
          {/* `capturedEt` already carries the " ET" suffix — see LiveOverlay. */}
          <span className="tabular-nums text-term-text">{live.capturedEt}</span>
          {!live.marketOpen &&
            ' with the market closed, so these are last prints and not moving quotes'}
          . <span className="text-term-faint">{mixedNote}</span>{' '}
          <span className="text-term-faint">
            Nothing live is stored anywhere, and none of it exists in production
            — the token this needs is never set there.
          </span>
        </span>
      ) : (
        <span className="text-term-dim">
          Prices are stored daily closes, the same reading production shows.{' '}
          <span className="text-term-faint">{live.reason}</span>
        </span>
      )}

      {live.unmatched.length > 0 && (
        <span className="text-term-faint">
          {live.unmatched.length} symbol
          {live.unmatched.length === 1 ? '' : 's'} the feed did not recognise, so
          {live.unmatched.length === 1 ? ' it keeps its' : ' they keep their'}{' '}
          stored close: {live.unmatched.slice(0, 8).join(', ')}
          {live.unmatched.length > 8 && ' and others'}.
        </span>
      )}
    </div>
  );
}
