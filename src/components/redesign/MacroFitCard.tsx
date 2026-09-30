import type { MacroFitMock } from '@/lib/redesign/mock';

/**
 * "Macro Fit" — a compact card near the top of the ticker workspace.
 *
 * Shows the current macro backdrop, this ticker's sector sensitivity, and
 * whether the two are aligned, neutral or conflicted — plus a one-line why and
 * the next risk event. The point is honesty: a strong single-name setup that
 * runs against the macro must read as "conflicts with macro", never as a false
 * all-clear.
 *
 * Layout-first preview: fed placeholder data.
 */
const FIT: Record<MacroFitMock['fit'], { label: string; tone: string; edge: string }> = {
  aligned: { label: 'Aligned with macro', tone: 'text-bull', edge: 'border-l-bull/60' },
  neutral: { label: 'Neutral vs macro', tone: 'text-flip', edge: 'border-l-flip/60' },
  conflicted: { label: 'Conflicts with macro', tone: 'text-bear', edge: 'border-l-bear/60' },
};

export function MacroFitCard({ fit }: { fit: MacroFitMock }) {
  const f = FIT[fit.fit];
  return (
    <section className={`panel border-l-2 ${f.edge} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <h2 className="label-xs">Macro fit</h2>
          <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
            macro context, not a prediction
          </span>
        </div>
        <span className={`text-sm font-bold ${f.tone}`}>{f.label}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-2xs uppercase tracking-[0.12em] text-term-faint">Sector</dt>
          <dd className="mt-0.5 text-xs font-bold text-term-text">{fit.sector}</dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-[0.12em] text-term-faint">Sensitivity</dt>
          <dd className="mt-0.5 text-xs text-term-dim">{fit.sensitivity}</dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-[0.12em] text-term-faint">Next risk</dt>
          <dd className="mt-0.5 text-xs text-term-dim">{fit.nextRisk}</dd>
        </div>
      </dl>

      <p className="mt-3 border-t border-term-line pt-2 text-xs leading-relaxed text-term-dim">
        {fit.why}
      </p>
    </section>
  );
}
