import {
  StaleDataBanner,
  pageStaleness,
  type FreshnessKind,
} from './StaleDataBanner';

export { pageStaleness, type FreshnessKind } from './StaleDataBanner';

/**
 * Per-page title strip, and the page's freshness guard.
 *
 * The old top header carried both navigation and page-specific provenance.
 * Navigation moved to the sidebar; this keeps the provenance — the "data as
 * of" stamp — attached to the page it describes.
 *
 * ## Why the staleness check lives here
 *
 * It used to be the page's job. Each surface called `snapshotStaleness`
 * itself, rendered `StaleDataBanner` itself, and formatted its own "data as
 * of" label — which meant the guard was present on five pages and absent on
 * the other eight. `/sectors` showed day-old numbers with nothing on screen to
 * say so, because nobody had remembered to add three lines to it.
 *
 * A check you have to remember is a check that is eventually forgotten, and
 * the forgetting is invisible: a page missing its banner looks exactly like a
 * page whose data is fine. So the bar every data page already renders now owns
 * it. Hand it a timestamp and the warning, the muting signal and the stamp all
 * follow from the same source, with one threshold (`TOLERANCE_MINUTES`) and
 * one wording in one file.
 *
 * A page that genuinely has no snapshot behind it — /guide, /methodology —
 * simply passes no timestamp and gets no banner, which is the honest result
 * rather than a silent one.
 */

export function PageBar({
  title,
  description,
  meta,
  freshness,
  asOfLabel,
  showBanner = true,
  titleLevel = 1,
}: {
  title: string;
  /**
   * One line saying what the page is for. Always rendered, never hover-only —
   * see `lib/pageMeta.ts`.
   */
  description?: string;
  /** Short right-aligned detail, e.g. counts or timestamps. */
  meta?: string;
  /**
   * The snapshot behind this page. Supply it and the bar grades it, warns
   * about it, and stamps it. Omit it only when the page has no snapshot.
   */
  freshness?: FreshnessKind;
  /**
   * Override the stamp's wording. For a page whose timestamp means something
   * more specific than "fetched at" — /decision shows the option book's own
   * quote time. The grading still comes from `freshness`; this changes only
   * the label, so the two can never disagree about whether data is stale.
   */
  asOfLabel?: string;
  /**
   * Render the warning elsewhere on the page.
   *
   * Only for a surface that has a deliberate reason to place it above its own
   * content — the front page puts the verdict first and the banner above that.
   * Such a page passes `false` here and renders `<StaleDataBanner>` itself
   * with `pageStaleness(...)`, so it still shares this file's verdict and
   * wording; it is choosing a position, not opting out of the check.
   */
  showBanner?: boolean;
  /**
   * Demote the heading to an `h2`.
   *
   * The home page puts its verdict above this bar and makes that the `h1`, so
   * a second `h1` underneath would give the page two top-level headings. Every
   * other page leaves this alone.
   */
  titleLevel?: 1 | 2;
}) {
  const Title = titleLevel === 1 ? 'h1' : 'h2';
  const staleness = freshness ? pageStaleness(freshness) : null;
  const stamp = asOfLabel ?? staleness?.asOfLabel ?? undefined;

  return (
    <>
      {staleness && showBanner && <StaleDataBanner staleness={staleness} />}

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0">
          <Title className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            {title}
          </Title>
          {description && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {meta && <p className="text-2xs text-term-faint">{meta}</p>}

          {stamp && (
            <div className="text-right">
              <div className="label-xs">Data as of</div>
              <div
                className={`text-xs tabular-nums ${
                  staleness?.stale ? 'font-bold text-bear' : 'text-term-dim'
                }`}
              >
                {stamp}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
