import type { GammaLevelsMock } from '@/lib/redesign/mock';
import { formatPrice } from '@/lib/format';

/**
 * The key gamma levels, stated once as text: flip, magnet above, magnet below,
 * and spot relative to the flip. Shared so the hero, the mobile mini-strip and
 * the collapsed map all name the same numbers — the failure `lib/simple/walls`
 * exists to prevent for the full page.
 *
 * Colour convention (unchanged from the rest of the app):
 *   flip = violet (a boundary, not a value), magnets = amber.
 */
export function GammaLevelSummary({
  levels,
  compact = false,
}: {
  levels: GammaLevelsMock;
  /** Tighter type for the mobile mini-strip. */
  compact?: boolean;
}) {
  const aboveFlip =
    levels.flipLevel === null ? null : levels.spot > levels.flipLevel;

  const size = compact ? 'text-sm' : 'text-lg';

  return (
    <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <div>
        <dt className="label-xs">Flip</dt>
        <dd className={`mt-0.5 font-bold tabular-nums text-level ${size}`}>
          {levels.flipLevel === null ? '—' : formatPrice(levels.flipLevel)}
        </dd>
        {!compact && (
          <dd className="text-2xs text-term-faint">
            {aboveFlip === null
              ? 'no flip in the chain'
              : aboveFlip
                ? 'spot above — dampened'
                : 'spot below — amplified'}
          </dd>
        )}
      </div>
      <div>
        <dt className="label-xs">Magnet ↑</dt>
        <dd className={`mt-0.5 font-bold tabular-nums text-pos ${size}`}>
          {levels.magnetAbove === null ? '—' : formatPrice(levels.magnetAbove)}
        </dd>
      </div>
      <div>
        <dt className="label-xs">Magnet ↓</dt>
        <dd className={`mt-0.5 font-bold tabular-nums text-pos ${size}`}>
          {levels.magnetBelow === null ? '—' : formatPrice(levels.magnetBelow)}
        </dd>
      </div>
      <div>
        <dt className="label-xs">Spot</dt>
        <dd className={`mt-0.5 font-bold tabular-nums text-term-text ${size}`}>
          {formatPrice(levels.spot)}
        </dd>
      </div>
    </dl>
  );
}
