/**
 * Per-page title strip.
 *
 * The old top header carried both navigation and page-specific provenance.
 * Navigation moved to the sidebar; this keeps the provenance — the "data as
 * of" stamp — attached to the page it describes.
 */
export function PageBar({
  title,
  description,
  meta,
  asOfLabel,
}: {
  title: string;
  /**
   * One line saying what the page is for. Always rendered, never hover-only —
   * see `lib/pageMeta.ts`.
   */
  description?: string;
  /** Short right-aligned detail, e.g. counts or timestamps. */
  meta?: string;
  asOfLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
      <div className="min-w-0">
        <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
            {description}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {meta && <p className="text-2xs text-term-faint">{meta}</p>}

        {asOfLabel && (
          <div className="text-right">
            <div className="label-xs">Data as of</div>
            <div className="text-xs tabular-nums text-term-dim">{asOfLabel}</div>
          </div>
        )}
      </div>
    </div>
  );
}
