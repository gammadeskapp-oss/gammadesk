/**
 * Whether /lab exists at all.
 *
 * ## Off unless switched on, and the default is off everywhere
 *
 * `GAMMADESK_LAB=1` in the environment. Anything else — unset, empty, `0`,
 * `false` — and both the page and its endpoint answer 404, exactly as they
 * would if the route had never been written.
 *
 * Default-off rather than default-off-in-production, because "production" is a
 * guess. `NODE_ENV` is `production` in a local `next start`, on a preview
 * deployment, and in whatever a future build step does; a gate that reads it
 * would open this page on every preview URL, which are public and indexed by
 * nobody but readable by anyone who has one. An explicit flag is a decision
 * somebody made, and there is nowhere it can be true by accident.
 *
 * ## 404 rather than 403
 *
 * A 403 confirms the route exists, which is the one thing an unlisted research
 * page has no reason to tell anybody. `notFound()` renders the same page a
 * typo does.
 *
 * This is not authentication and is not meant to be. It is a switch that keeps
 * an experiment from shipping with the deploy that happens to contain it. The
 * endpoint behind it carries the same cron auth as every other manual endpoint
 * here, so the two failures — deployed by accident, and called by a stranger —
 * are covered separately.
 */
export function labEnabled(): boolean {
  const raw = process.env.GAMMADESK_LAB?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}
