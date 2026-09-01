import type { ConditionResult, Coverage, HorizonStats } from '@/lib/analogues';
import { THIN_SAMPLE } from '@/lib/analogues';

/**
 * One condition's forward-return table.
 *
 * ## The display rules are the point
 *
 * This component is where the honesty rules live, not the docs. Specifically:
 *
 *   - Best and worst sit on the same row as the median, always. A median alone
 *     is the single most misleading number this data can produce, so there is
 *     no code path that renders one without its extremes beside it.
 *   - Under ten matches the medians are greyed and the table is labelled
 *     "pattern, not proof". The table is still shown in full — hiding a thin
 *     sample would leave the reader to assume something worse, and dressing it
 *     up would be the actual dishonesty.
 *   - The lookback window is stated on every table. A pattern with history back
 *     to 1993 and one back to 2019 are not comparable claims, and nothing here
 *     lets them be read side by side without saying so.
 *   - Overlap and single-year clustering are printed as counts, not hidden
 *     behind a footnote.
 *
 * No phrasing implies an action. Columns say what followed; nothing says what
 * to do about it.
 */

function pct(value: number | null, digits = 1): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

function tone(value: number | null): string {
  if (value === null) return 'text-term-faint';
  if (value > 0) return 'text-bull';
  if (value < 0) return 'text-bear';
  return 'text-term-dim';
}

function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-2xs leading-relaxed text-flip">{children}</p>
  );
}

function Row({ stats, thin }: { stats: HorizonStats; thin: boolean }) {
  // Greyed rather than withheld: the number is still the number, it just is
  // not carrying the weight the reader might otherwise give it.
  const medianTone = thin ? 'text-term-faint' : tone(stats.medianReturn);

  return (
    <tr className="border-t border-term-line">
      <td className="py-1.5 pr-3 text-term-text">{stats.horizon}d</td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-term-dim">
        {stats.n}
      </td>
      <td className={`py-1.5 pr-3 text-right tabular-nums ${medianTone}`}>
        {pct(stats.medianReturn)}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-bull">
        {pct(stats.bestReturn)}
        {stats.bestDate && (
          <span className="ml-1 text-2xs text-term-faint">{stats.bestDate}</span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-bear">
        {pct(stats.worstReturn)}
        {stats.worstDate && (
          <span className="ml-1 text-2xs text-term-faint">{stats.worstDate}</span>
        )}
      </td>
      <td className={`py-1.5 pr-3 text-right tabular-nums ${thin ? 'text-term-faint' : 'text-term-dim'}`}>
        {stats.positivePct === null ? '—' : `${stats.positivePct.toFixed(0)}%`}
      </td>
      <td className={`py-1.5 pr-3 text-right tabular-nums ${thin ? 'text-term-faint' : 'text-term-dim'}`}>
        {pct(stats.medianDrawdown)}
      </td>
      <td className="py-1.5 text-right tabular-nums text-bear">
        {pct(stats.worstDrawdown)}
      </td>
    </tr>
  );
}

export function AnalogueTable({
  condition,
  coverage,
}: {
  condition: ConditionResult;
  coverage: Coverage;
}) {
  const { matches, honesty } = condition;
  const count = matches.length;

  return (
    <section className="panel space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-term-text">
            {condition.label}
          </h3>
          <p className="mt-1 text-2xs leading-relaxed text-term-dim">
            {condition.rule}
          </p>
        </div>
        <p className="text-2xs tabular-nums text-term-faint">
          {count} {count === 1 ? 'match' : 'matches'}
          {honesty.overlapping > 0 && `, ${honesty.overlapping} overlapping`}
        </p>
      </div>

      {/*
        Stated on every table, without exception. Two conditions on the same
        screen can rest on wildly different amounts of history, and the reader
        has no way to know that from the medians.
      */}
      <p className="text-2xs text-term-faint">
        Lookback {coverage.firstDate} → {coverage.lastDate} ({coverage.years} years,{' '}
        {coverage.bars.toLocaleString()} sessions)
        {condition.firstMatch && (
          <>
            {' '}· matches span {condition.firstMatch} → {condition.lastMatch}
          </>
        )}
      </p>

      {count === 0 ? (
        <p className="text-xs text-term-dim">
          No session in the stored history completed this condition.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {honesty.thin && (
              <Caveat>
                Pattern, not proof — {count}{' '}
                {count === 1 ? 'match is' : 'matches are'} fewer than the{' '}
                {THIN_SAMPLE} this page treats as a sample. Medians are greyed.
              </Caveat>
            )}
            {honesty.overlapping > 0 && (
              <Caveat>
                {count} matches, {honesty.overlapping} overlapping — that many
                fall within 42 sessions of an earlier match, so their forward
                windows share sessions and are not independent observations.
              </Caveat>
            )}
            {honesty.clusteredYear && (
              <Caveat>
                {honesty.clusteredYear.count} of {count} matches fall in{' '}
                {honesty.clusteredYear.year} alone. More than half the history
                here is one year.
              </Caveat>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <caption className="sr-only">
                What followed the {count} sessions that completed{' '}
                {condition.label} on {coverage.symbol}, by horizon.
              </caption>
              <thead>
                <tr className="text-2xs uppercase tracking-[0.14em] text-term-faint">
                  <th scope="col" className="pb-1 pr-3 text-left font-normal">
                    Horizon
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    n
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    Median
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    Best
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    Worst
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    Positive
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    Median DD
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    Worst DD
                  </th>
                </tr>
              </thead>
              <tbody>
                {condition.horizons.map((h) => (
                  <Row key={h.horizon} stats={h} thin={honesty.thin} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-2xs leading-relaxed text-term-faint">
            Returns are close to close from the session that completed the
            condition, on split-adjusted prices, excluding dividends. DD is the
            deepest close inside the window. Horizons with a smaller n have
            matches whose window has not finished yet; those are left out of
            that row rather than counted early.
          </p>
        </>
      )}
    </section>
  );
}
