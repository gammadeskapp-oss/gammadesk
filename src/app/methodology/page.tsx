import { permanentRedirect } from 'next/navigation';

/**
 * The methodology is now the bottom of `/guide`, under `#methodology`.
 *
 * Kept as a route rather than deleted: this URL has been linked from every
 * methodology drawer on the site, from the nav, and from anywhere anyone has
 * bookmarked it. 308 rather than 307 — the move is not coming back, and a
 * permanent status is what tells a crawler to stop asking.
 *
 * The subsection anchors (`#inputs`, `#levels`, `#gamma-exposure`, `#flow`,
 * `#freshness`, `#limits`) moved to `/guide` unchanged, so the drawers link
 * straight there and keep landing on the exact block they name. A redirect
 * cannot carry a fragment through, which is why they were repointed rather
 * than left to arrive here.
 */
export default function MethodologyPage(): never {
  permanentRedirect('/guide#methodology');
}
