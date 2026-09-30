import type { DriverState, MacroBiasMock } from '@/lib/redesign/mock';

/**
 * Macro Bias, as a first-class, inspectable feature — rendered once on Home,
 * directly under the regime/levels hero.
 *
 * It is deliberately SEPARATE from the gamma score and never merged into one
 * uninspectable number: gamma answers "how will dealer hedging behave", this
 * answers "what is the macro backdrop". The card shows the exact inputs and
 * their states so the reader can audit the direction rather than trust it.
 *
 * The score is a −5..+5 DIRECTION scale; confidence is shown separately, so a
 * confident "flat" and an uncertain "bearish" never collapse into the same
 * figure. Phrased as context, never as buy/sell.
 */

const STATE_TONE: Record<DriverState, string> = {
  tailwind: 'text-bull',
  neutral: 'text-flip',
  headwind: 'text-bear',
};

const STATE_LABEL: Record<DriverState, string> = {
  tailwind: 'tailwind',
  neutral: 'neutral',
  headwind: 'headwind',
};

/** The −5..+5 meter. Green right of centre, red left, violet flip at zero. */
function ScoreMeter({ score }: { score: number }) {
  // Map −5..+5 to 0..100% for the marker position.
  const pct = ((score + 5) / 10) * 100;
  const tone = score > 0 ? 'text-bull' : score < 0 ? 'text-bear' : 'text-term-text';
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold tabular-nums leading-none ${tone}`}>
          {score > 0 ? '+' : ''}
          {score}
        </span>
        <span className="text-2xs text-term-faint">on −5…+5</span>
      </div>
      <div className="relative mt-2 h-1.5 w-full bg-term-raised">
        {/* centre (flip) marker */}
        <span aria-hidden className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-level" />
        <span
          aria-hidden
          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            score > 0 ? 'bg-bull' : score < 0 ? 'bg-bear' : 'bg-term-text'
          }`}
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function MacroBiasCard({ macro }: { macro: MacroBiasMock }) {
  const delta = macro.priorScore === null ? null : macro.score - macro.priorScore;
  const changedLine =
    macro.priorScore === null || delta === null
      ? 'No prior reading tracked yet'
      : delta === 0
        ? 'Unchanged since yesterday'
        : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} since yesterday (was ${
            macro.priorScore > 0 ? '+' : ''
          }${macro.priorScore})`;

  const headlineTone =
    macro.score > 0 ? 'text-bull' : macro.score < 0 ? 'text-bear' : 'text-term-text';

  return (
    <section className="panel border-l-2 border-l-flip/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-term-text">
            Macro Bias
          </h2>
          <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
            Macro context, not a prediction
          </span>
        </div>
        <span className={`text-base font-bold ${headlineTone}`}>{macro.label}</span>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <ScoreMeter score={macro.score} />

        <div className="flex flex-col justify-center gap-1 sm:items-end sm:text-right">
          <div className="flex items-baseline gap-1.5">
            <span className="label-xs">Confidence</span>
            <span className="text-sm font-bold tabular-nums text-term-text">{macro.confidence}%</span>
          </div>
          <span className="text-2xs text-term-faint">{changedLine}</span>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-term-dim">{macro.reason}</p>

      {/* Drivers — the exact inputs and their current states. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-term-line pt-3 sm:grid-cols-3">
        {macro.drivers.map((d) => (
          <div key={d.key}>
            <dt className="flex items-baseline justify-between gap-1">
              <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">{d.label}</span>
              <span className={`text-2xs font-bold ${STATE_TONE[d.state]}`}>{STATE_LABEL[d.state]}</span>
            </dt>
            <dd className="mt-0.5 text-xs font-bold tabular-nums text-term-text">{d.value}</dd>
            <dd className="text-2xs text-term-faint">{d.note}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 border-t border-term-line pt-3 text-2xs text-term-dim">
        <span className="text-term-faint">Next catalyst: </span>
        <span className="font-bold text-term-text">{macro.nextCatalyst.label}</span> ·{' '}
        {macro.nextCatalyst.when}
      </p>

      {/* Daily history — score, drivers, what changed, next event. */}
      {macro.history.length > 0 && (
      <details className="group mt-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-2xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-pos transition-transform group-open:rotate-90">
            &#9656;
          </span>
          <span className="uppercase tracking-[0.12em]">Daily history</span>
        </summary>
        <ul className="mt-2 space-y-1.5">
          {macro.history.map((h) => (
            <li
              key={h.date}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-l border-term-line pl-2 text-2xs"
            >
              <span className="w-20 shrink-0 text-term-faint">{h.date}</span>
              <span
                className={`w-8 shrink-0 font-bold tabular-nums ${
                  h.score > 0 ? 'text-bull' : h.score < 0 ? 'text-bear' : 'text-term-text'
                }`}
              >
                {h.score > 0 ? '+' : ''}
                {h.score}
              </span>
              <span className="text-term-dim">{h.changed}</span>
              <span className="text-term-faint">· next: {h.nextEvent}</span>
            </li>
          ))}
        </ul>
      </details>
      )}
    </section>
  );
}
