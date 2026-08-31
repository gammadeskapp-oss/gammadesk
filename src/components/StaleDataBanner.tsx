import type { Staleness } from '@/lib/staleness';

/**
 * Full-width warning shown above everything else when the snapshot behind a
 * page predates the market activity it claims to describe.
 *
 * Deliberately not dismissible and deliberately not subtle. The failure this
 * guards against is silent: the feed dies, the page still renders a complete
 * set of confident-looking levels, and nothing about them says they are from
 * yesterday. Every other warning on this site is a qualifier; this one is a
 * stop sign.
 *
 * Rendering is the caller's decision — pass a `Staleness` and this returns
 * null when the data is fine, so a page can put it at the top unconditionally.
 */
export function StaleDataBanner({ staleness }: { staleness: Staleness }) {
  if (!staleness.stale) return null;

  const stamp = staleness.asOfLabel ?? 'unknown';

  return (
    <div
      role="alert"
      className="border-l-2 border-l-bear bg-bear/[0.12] px-4 py-3 sm:px-6"
    >
      <p className="text-sm font-bold leading-relaxed text-bear">
        Data unavailable — last successful update: {stamp}.
      </p>
      <p className="mt-1 text-sm font-bold leading-relaxed text-bear">
        Do not use these levels for trading decisions.
      </p>
      <p className="mt-2 text-2xs leading-relaxed text-term-dim">
        {staleness.ageHours === null
          ? 'The snapshot carries no usable timestamp, so its age cannot be established. '
          : `That is ${staleness.ageHours.toFixed(1)} hours old. `}
        {staleness.expectedNote}{' '}
        <a href="/status" className="underline hover:text-term-text">
          Check which jobs are failing
        </a>
        .
      </p>
    </div>
  );
}

/**
 * Class names that mute a level number while the banner is up.
 *
 * A single helper rather than a class string copied into each page, so muting
 * cannot end up applied on one surface and forgotten on another — which would
 * be the worst outcome available: a page that warns at the top and still shows
 * crisp, readable numbers below it.
 */
export function mutedIf(stale: boolean): string {
  return stale ? 'opacity-40 grayscale' : '';
}
