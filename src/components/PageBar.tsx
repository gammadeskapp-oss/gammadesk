import type { DataSource } from '@/lib/types';

/**
 * Per-page title strip.
 *
 * The old top header carried both navigation and page-specific provenance.
 * Navigation moved to the sidebar; this keeps the provenance — the "data as
 * of" stamp and the sample-data badge — attached to the page it describes.
 */
export function PageBar({
  title,
  meta,
  asOfLabel,
  source,
}: {
  title: string;
  /** Short right-aligned detail, e.g. counts or timestamps. */
  meta?: string;
  asOfLabel?: string;
  source?: DataSource;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
      <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
        {title}
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        {meta && <p className="text-2xs text-term-faint">{meta}</p>}

        {source === 'sample' && (
          <span className="border border-flip/50 bg-flip/10 px-2 py-1 text-2xs font-bold uppercase tracking-[0.14em] text-flip">
            Sample data
          </span>
        )}

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
