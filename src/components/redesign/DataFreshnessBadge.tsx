import type { FreshnessLevel } from '@/lib/redesign/mock';

/**
 * A single, shared definition of "how fresh is this data" — so the phrasing
 * and colour never drift between the sticky status bar, the hero and the
 * preview cards. Purely presentational; graded upstream and handed the level.
 *
 * fresh → green, stale → red, updating → amber (the caveat/neutral tone).
 */
export function DataFreshnessBadge({
  level,
  label,
}: {
  level: FreshnessLevel;
  /** e.g. "as of 15:52 ET" or "Friday's close". */
  label: string;
}) {
  const tone =
    level === 'fresh'
      ? 'border-bull/50 text-bull'
      : level === 'stale'
        ? 'border-bear/50 text-bear'
        : 'border-flip/50 text-flip';

  const dot =
    level === 'fresh' ? 'bg-bull' : level === 'stale' ? 'bg-bear' : 'bg-flip';

  const word = level === 'fresh' ? 'Live' : level === 'stale' ? 'Stale' : 'Updating';

  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-2xs uppercase tracking-[0.12em] ${tone}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="font-bold">{word}</span>
      <span className="text-term-faint normal-case tracking-normal">{label}</span>
    </span>
  );
}
