import { Fragment } from 'react';
import type {
  BaselineStats, ConditionResult, Coverage, HorizonStats,
} from '@/lib/analogues';
import {
  comparisonSentence, horizonLabel, overlapSentence, verdictFor,
  MEANINGFUL_GAP_PP, THIN_SAMPLE,
} from '@/lib/analogues';

/**
 * One condition's forward-return table, written for someone who has never seen
 * the page before.
 *
 * ## The order is the argument
 *
 * A first-time reader gets the answer first and the machinery afterwards: the
 * verdict, then how to read the table, then the table, then the caveats, then
 * the method behind a toggle. Everything that was here before is still here —
 * nothing was removed to make it simpler, only demoted.
 *
 * ## The display rules are still the point
 *
 *   - Best and worst sit on the same row as the typical result, always. A
 *     median alone is the single most misleading number this data can produce,
 *     so there is no code path that renders one without its extremes beside it.
 *   - Under ten matches the typical results are greyed and the table is
 *     labelled "pattern, not proof". The table is still shown in full — hiding
 *     a thin sample would leave the reader to assume something worse, and
 *     dressing it up would be the actual dishonesty.
 *   - The lookback window is stated on every table.
 *   - Overlap is expressed as episodes, in plain words, naming what clusters.
 *   - Every period carries an unconditional baseline row beneath it, and the
 *     reader is told in one sentence what to do with it.
 *
 * No phrasing implies an action. Columns say what followed; nothing says what
 * to do about it, and no significance test is computed or implied.
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
  return <p className="text-2xs leading-relaxed text-flip">{children}</p>;
}

function Row({ stats, thin }: { stats: HorizonStats; thin: boolean }) {
  // Greyed rather than withheld: the number is still the number, it just is
  // not carrying the weight the reader might otherwise give it.
  const medianTone = thin ? 'text-term-faint' : tone(stats.medianReturn);

  return (
    <tr className="border-t border-term-line">
      <td className="py-1.5 pr-3 text-term-text">
        {horizonLabel(stats.horizon)}
        <span className="ml-1 text-2xs text-term-faint">
          {stats.horizon} {stats.horizon === 1 ? 'session' : 'sessions'}
        </span>
      </td>
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
      <td
        className={`py-1.5 pr-3 text-right tabular-nums ${thin ? 'text-term-faint' : 'text-term-dim'}`}
      >
        {stats.positivePct === null ? '—' : `${stats.positivePct.toFixed(0)}%`}
      </td>
      <td
        className={`py-1.5 pr-3 text-right tabular-nums ${thin ? 'text-term-faint' : 'text-term-dim'}`}
      >
        {pct(stats.medianDrawdown)}
      </td>
      <td className="py-1.5 text-right tabular-nums text-bear">
        {pct(stats.worstDrawdown)}
      </td>
    </tr>
  );
}

/**
 * The unconditional row, directly under its condition row.
 *
 * Paired with each period rather than gathered into its own block: the
 * comparison only means anything period by period, and a reader should not
 * have to hold one number in their head while they scroll to find the other.
 */
function BaselineRow({ stats }: { stats: BaselineStats }) {
  return (
    <tr className="text-term-faint">
      <td className="pb-1.5 pr-3 pl-3 text-2xs">A random day, for comparison</td>
      <td className="pb-1.5 pr-3 text-right text-2xs tabular-nums">
        {stats.n.toLocaleString()}
      </td>
      <td className="pb-1.5 pr-3 text-right text-2xs tabular-nums">
        {pct(stats.medianReturn)}
      </td>
      {/* No best or worst: the extremes of every window in 33 years are not a
          comparison, they are just the largest moves in the series. */}
      <td className="pb-1.5 pr-3 text-right text-2xs">—</td>
      <td className="pb-1.5 pr-3 text-right text-2xs">—</td>
      <td className="pb-1.5 pr-3 text-right text-2xs tabular-nums">
        {stats.positivePct === null ? '—' : `${stats.positivePct.toFixed(0)}%`}
      </td>
      <td className="pb-1.5 pr-3 text-right text-2xs tabular-nums">
        {pct(stats.medianDrawdown)}
      </td>
      <td className="pb-1.5 text-right text-2xs">—</td>
    </tr>
  );
}

const HEADINGS = [
  'How long after',
  'Times it happened',
  'Typical result',
  'Best time',
  'Worst time',
  'Went up',
  'Typical dip along the way',
  'Worst dip along the way',
];

export function AnalogueTable({
  condition,
  coverage,
  baseline,
}: {
  condition: ConditionResult;
  coverage: Coverage;
  /** One entry per period, over the same lookback. */
  baseline: BaselineStats[];
}) {
  const { matches, honesty } = condition;
  const count = matches.length;
  const verdict = verdictFor(condition, baseline);
  const comparison = comparisonSentence(condition, baseline);
  const overlap = overlapSentence(condition);

  /*
   * The verdict is the only coloured thing at the top of the panel. Amber for
   * "nothing", because a caveat is what that answer is, and the two
   * directional tones otherwise.
   */
  const verdictTone =
    verdict?.tone === 'better'
      ? 'text-bull'
      : verdict?.tone === 'worse'
        ? 'text-bear'
        : 'text-flip';

  return (
    <section className="panel space-y-3 px-4 py-4">
      <div className="min-w-0">
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-term-text">
          {condition.label}
        </h3>
        <p className="mt-1 text-2xs leading-relaxed text-term-dim">
          {condition.rule}
        </p>
      </div>

      {count === 0 ? (
        <p className="text-xs text-term-dim">
          No session in the stored history completed this condition.
        </p>
      ) : (
        <>
          {verdict && (
            <div className="space-y-1 border-y border-term-line py-3">
              <p className={`text-sm font-bold leading-snug ${verdictTone}`}>
                {verdict.text}
              </p>
              {/*
                Percent-positive is printed rather than folded into the word
                above, so a condition whose typical result beat a random day
                while going up less often shows up as exactly that. The
                reasoning is in `verdictFor`.
              */}
              <p className="text-xs leading-relaxed text-term-dim">
                It went up {verdict.condPositive.toFixed(0)}% of the time over{' '}
                {horizonLabel(verdict.horizon)}, against{' '}
                {verdict.basePositive.toFixed(0)}% after a random day.
              </p>
              <p className="text-2xs leading-relaxed text-term-faint">
                &quot;Better&quot; and &quot;worse&quot; here mean the typical
                result was at least {MEANINGFUL_GAP_PP} percentage points away
                from a random day over {horizonLabel(verdict.horizon)}. These
                words are a rough guide, not a statistical test. Shorter periods
                in the table may read differently.
              </p>
            </div>
          )}

          {/* Everything below the answer: kept in full, demoted in size. */}
          <div className="space-y-1">
            {honesty.thin && (
              <Caveat>
                Pattern, not proof — {count}{' '}
                {count === 1 ? 'time is' : 'times is'} fewer than the{' '}
                {THIN_SAMPLE} this page treats as a sample. Typical results are
                greyed.
              </Caveat>
            )}
            {overlap && (
              <Caveat>
                {overlap}{' '}
                <span className="text-term-faint">
                  {honesty.overlapping} of the {count} fall within 42 sessions
                  of an earlier one, so their windows share sessions.
                </span>
              </Caveat>
            )}
            {honesty.clusteredYear && (
              <Caveat>
                {honesty.clusteredYear.count} of {count} fall in{' '}
                {honesty.clusteredYear.year} alone. More than half the history
                here is one year.
              </Caveat>
            )}
            <p className="text-2xs text-term-faint">
              Looking back over {coverage.firstDate} to {coverage.lastDate} (
              {coverage.years} years, {coverage.bars.toLocaleString()} trading
              days)
              {condition.firstMatch && (
                <>
                  {' '}· it happened between {condition.firstMatch} and{' '}
                  {condition.lastMatch}
                </>
              )}
            </p>
          </div>

          <p className="text-xs leading-relaxed text-term-dim">
            Compare each row to the grey &quot;random day&quot; row underneath
            it. If they look the same, the pattern didn&apos;t matter.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <caption className="sr-only">
                What followed the {count} sessions that completed{' '}
                {condition.label} on {coverage.symbol}, each period compared
                against a random day.
              </caption>
              <thead>
                <tr className="text-2xs uppercase tracking-[0.14em] text-term-faint">
                  {HEADINGS.map((heading, i) => (
                    <th
                      key={heading}
                      scope="col"
                      className={`pb-1 font-normal ${i === 0 ? 'text-left' : 'text-right'} ${
                        i === HEADINGS.length - 1 ? '' : 'pr-3'
                      }`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {condition.horizons.map((h) => (
                  <Fragment key={h.horizon}>
                    <Row stats={h} thin={honesty.thin} />
                    {/*
                      Rendered even when the baseline is missing a period, so a
                      condition row is never left sitting on its own looking
                      like it needs no comparison.
                    */}
                    <BaselineRow
                      stats={
                        baseline.find((b) => b.horizon === h.horizon) ?? {
                          horizon: h.horizon,
                          n: 0,
                          medianReturn: null,
                          positivePct: null,
                          medianDrawdown: null,
                        }
                      }
                    />
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {comparison && (
            <p className="text-2xs leading-relaxed text-term-dim">
              {comparison.text}
            </p>
          )}

          {/*
            The method, kept in full and closed by default. None of it was cut —
            a reader who wants to check the definitions still gets every one,
            and a reader meeting the page for the first time is not asked to
            read six technical notes before the answer.
          */}
          <details className="border-t border-term-line pt-2">
            <summary className="cursor-pointer text-2xs uppercase tracking-[0.14em] text-term-faint">
              How this is calculated
            </summary>
            <div className="mt-2 space-y-1 text-2xs leading-relaxed text-term-faint">
              <p>
                Price returns, excludes dividends — close to close from the
                session that completed the condition, on split-adjusted prices.
              </p>
              <p>
                &quot;Dip along the way&quot; is measured on closes, not
                intraday lows: the deepest close inside the window against the
                starting close. An intraday figure would be deeper.
              </p>
              <p>
                Periods showing fewer times than the total have examples whose
                window has not finished yet; those are left out of that row
                rather than counted early.
              </p>
              <p>
                The <span className="text-term-dim">random day</span> row under
                each period is every window of that length in the same lookback,
                condition or not, measured the same way. It is what an entry
                picked at random did.
              </p>
              <p>
                That row includes the early sessions where this condition could
                not yet fire — a 200-day average and a 52-week high need a year
                of history before they exist at all. It is the same figure under
                every table on this page, which is what makes the conditions
                comparable with each other.
              </p>
              <p>
                The comparison worth making is the gap between the two rows, not
                the level of either. No significance test is applied anywhere on
                this page.
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
