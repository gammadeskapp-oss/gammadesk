import { Fragment } from 'react';
import type {
  BaselineStats, ConditionResult, Coverage, HorizonStats,
} from '@/lib/analogues';
import {
  comparisonSentence, horizonLabel, overlapSentence, verdictFor,
  EPISODE_NOTE, MEANINGFUL_GAP_PP, THIN_SAMPLE,
} from '@/lib/analogues';

/**
 * One pattern's results, written for someone who has never traded.
 *
 * ## Two things above the table, everything else below it
 *
 * The verdict and the one-line guide to reading the grid. That is all a first
 * time reader has to get through before the numbers. Every caveat still ships
 * — the thin-sample label, the clumping, the single-year clustering, the
 * history used — but underneath, where it qualifies an answer the reader has
 * already seen rather than delaying it.
 *
 * ## The grid is a grid
 *
 * Each period is a pair of rows: what happened after the pattern, and what
 * normally happens, the second indented and tinted so it reads as attached to
 * the one above rather than floating between groups. Pairs are separated by
 * more space than the two rows inside a pair, which is what makes the pairing
 * visible without drawing a box around it.
 *
 * Numbers use `tabular-nums` and fixed column widths so digits line up down
 * the column, and dates sit on their own line under the figure they belong to
 * instead of crowding it.
 *
 * ## The display rules are still the point
 *
 *   - Best and worst sit on the same row as the typical result, always.
 *   - Under ten times the results are greyed and the panel says so.
 *   - The history used is stated on every panel.
 *   - Clumping is stated in plain words.
 *   - Every period carries its "what normally happens" row.
 *
 * No phrasing implies an action, and no significance test is computed.
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

/** Shared by both rows of a pair, so the columns cannot drift apart. */
const NUM = 'text-right tabular-nums';

function Row({ stats, thin }: { stats: HorizonStats; thin: boolean }) {
  // Greyed rather than withheld: the number is still the number, it just is
  // not carrying the weight the reader might otherwise give it.
  const resultTone = thin ? 'text-term-faint' : tone(stats.medianReturn);

  return (
    <tr>
      <td className="py-2 pl-3 pr-3 align-top text-term-text">
        {horizonLabel(stats.horizon)}
        <span className="block text-2xs text-term-faint">
          {stats.horizon} {stats.horizon === 1 ? 'session' : 'sessions'}
        </span>
      </td>
      <td className={`py-2 pr-4 align-top ${NUM} text-term-dim`}>{stats.n}</td>
      <td className={`py-2 pr-4 align-top ${NUM} ${resultTone}`}>
        {pct(stats.medianReturn)}
      </td>
      <td className={`py-2 pr-4 align-top ${NUM} text-bull`}>
        {pct(stats.bestReturn)}
        {stats.bestDate && (
          <span className="block text-2xs font-normal text-term-faint">
            {stats.bestDate}
          </span>
        )}
      </td>
      <td className={`py-2 pr-4 align-top ${NUM} text-bear`}>
        {pct(stats.worstReturn)}
        {stats.worstDate && (
          <span className="block text-2xs font-normal text-term-faint">
            {stats.worstDate}
          </span>
        )}
      </td>
      <td
        className={`py-2 pr-4 align-top ${NUM} ${thin ? 'text-term-faint' : 'text-term-dim'}`}
      >
        {stats.positivePct === null ? '—' : `${stats.positivePct.toFixed(0)}%`}
      </td>
      <td
        className={`py-2 pr-4 align-top ${NUM} ${thin ? 'text-term-faint' : 'text-term-dim'}`}
      >
        {pct(stats.medianDrawdown)}
      </td>
      <td className={`py-2 pr-3 align-top ${NUM} text-bear`}>
        {pct(stats.worstDrawdown)}
      </td>
    </tr>
  );
}

/**
 * What normally happens, directly under the row it qualifies.
 *
 * Indented and tinted rather than boxed: the pairing has to be obvious at a
 * glance without adding sixteen borders to a table that already carries eight
 * columns.
 */
function NormalRow({
  stats,
  totalDays,
}: {
  stats: BaselineStats;
  /** Sessions in the symbol's history, named so the row cannot be read as one
   *  day picked out on its own. */
  totalDays: number;
}) {
  return (
    <tr className="bg-term-raised/40 text-term-faint">
      <td className="py-2 pl-6 pr-3 align-top text-2xs">
        What normally happens
        <span className="block text-term-faint/70">
          all {totalDays.toLocaleString()} days, not just these
        </span>
      </td>
      <td className={`py-2 pr-4 align-top text-2xs ${NUM}`}>
        {stats.n.toLocaleString()}
      </td>
      <td className={`py-2 pr-4 align-top text-2xs ${NUM}`}>
        {pct(stats.medianReturn)}
      </td>
      {/* No best or worst: the extremes of every window in the whole history
          are not a comparison, they are just the biggest moves there were. */}
      <td className={`py-2 pr-4 align-top text-2xs ${NUM}`}>—</td>
      <td className={`py-2 pr-4 align-top text-2xs ${NUM}`}>—</td>
      <td className={`py-2 pr-4 align-top text-2xs ${NUM}`}>
        {stats.positivePct === null ? '—' : `${stats.positivePct.toFixed(0)}%`}
      </td>
      <td className={`py-2 pr-4 align-top text-2xs ${NUM}`}>
        {pct(stats.medianDrawdown)}
      </td>
      <td className={`py-2 pr-3 align-top text-2xs ${NUM}`}>—</td>
    </tr>
  );
}

/** Header text, and whether the column holds words or figures. */
const HEADINGS: { label: string; numeric: boolean; width: string }[] = [
  { label: 'How long after', numeric: false, width: 'w-[16%]' },
  { label: 'Times', numeric: true, width: 'w-[9%]' },
  { label: 'Typical result', numeric: true, width: 'w-[13%]' },
  { label: 'Best time', numeric: true, width: 'w-[14%]' },
  { label: 'Worst time', numeric: true, width: 'w-[14%]' },
  { label: 'Went up', numeric: true, width: 'w-[10%]' },
  { label: 'Typical dip', numeric: true, width: 'w-[12%]' },
  { label: 'Worst dip', numeric: true, width: 'w-[12%]' },
];

export function AnalogueTable({
  condition,
  coverage,
  baseline,
}: {
  condition: ConditionResult;
  coverage: Coverage;
  /** One entry per period, over the same history. */
  baseline: BaselineStats[];
}) {
  const { matches, honesty } = condition;
  const count = matches.length;
  const verdict = verdictFor(condition, baseline);
  const comparison = comparisonSentence(condition, baseline);
  const overlap = overlapSentence(condition);

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
          This never happened in the stored history.
        </p>
      ) : (
        <>
          {/* One of the two things above the table. */}
          {verdict && (
            <div className="space-y-1 border-y border-term-line py-3">
              <p className={`text-sm font-bold leading-snug ${verdictTone}`}>
                {verdict.text}
              </p>
              <p className="text-xs leading-relaxed text-term-dim">
                {verdict.detail}
              </p>
            </div>
          )}

          {/* The other. */}
          <p className="text-xs leading-relaxed text-term-dim">
            The grey line under each row is what normally happens. If the two
            lines look alike, this pattern did not matter.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed text-xs">
              <caption className="sr-only">
                What happened after the {count} times {condition.label} on{' '}
                {coverage.symbol}, each period paired with what normally
                happens.
              </caption>
              <thead>
                <tr className="border-b border-term-line text-2xs uppercase tracking-[0.14em] text-term-faint">
                  {HEADINGS.map((heading, i) => (
                    <th
                      key={heading.label}
                      scope="col"
                      className={`pb-2 font-normal ${heading.width} ${
                        heading.numeric ? 'text-right' : 'text-left'
                      } ${i === 0 ? 'pl-3' : ''} ${
                        i === HEADINGS.length - 1 ? 'pr-3' : 'pr-4'
                      }`}
                    >
                      {heading.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {/*
                One tbody per period. The gap between groups comes from the
                body border rather than padding on the rows, so the two rows of
                a pair stay tight against each other while the pairs breathe.
              */}
              {condition.horizons.map((h) => (
                <tbody
                  key={h.horizon}
                  className="border-b-4 border-term-bg align-top"
                >
                  <Row stats={h} thin={honesty.thin} />
                  <NormalRow
                    totalDays={coverage.bars}
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
                </tbody>
              ))}
            </table>
          </div>

          {/* Everything that used to sit above the table. */}
          <div className="space-y-1 border-t border-term-line pt-3">
            {honesty.thin && (
              <Caveat>
                This has happened fewer than {THIN_SAMPLE} times, which is too
                few to trust. The results are greyed for that reason.
              </Caveat>
            )}
            {overlap && <Caveat>{overlap}</Caveat>}
            {honesty.clusteredYear && (
              <Caveat>
                {honesty.clusteredYear.count} of the {count} happened in{' '}
                {honesty.clusteredYear.year} alone. More than half of this is
                one year.
              </Caveat>
            )}
            {comparison && (
              <p className="text-2xs leading-relaxed text-term-dim">
                {comparison.text}
              </p>
            )}
            <p className="text-2xs text-term-faint">
              History used: {coverage.firstDate} to {coverage.lastDate} (
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

          {/*
            The method, kept in full and closed by default. Nothing was cut —
            a reader who wants the definitions still gets every one, and a
            reader meeting the page for the first time is not asked to read
            them before the answer.
          */}
          <details className="border-t border-term-line pt-2">
            <summary className="cursor-pointer text-2xs uppercase tracking-[0.14em] text-term-faint">
              How this is calculated
            </summary>
            <div className="mt-2 space-y-1 text-2xs leading-relaxed text-term-faint">
              <p>
                &quot;Better&quot; and &quot;worse&quot; in the headline mean
                the median return was at least {MEANINGFUL_GAP_PP} percentage
                points from the baseline over{' '}
                {horizonLabel(verdict?.horizon ?? 42)}. When the median and the
                positive rate disagree in direction, the headline reports the
                disagreement instead of picking one. These are presentation
                cutoffs, not a significance test.
              </p>
              <p>
                Price returns, excludes dividends — close to close from the
                session that completed the condition, on split-adjusted prices.
              </p>
              <p>
                &quot;Typical dip&quot; and &quot;worst dip&quot; are the
                maximum drawdown inside the window, measured on closes rather
                than intraday lows: the deepest close against the entry close.
                An intraday figure would be deeper.
              </p>
              <p>
                Periods showing fewer times than the total have matches whose
                forward window has not finished yet; those are truncated out of
                that row rather than counted early.
              </p>
              <p>
                The <span className="text-term-dim">what normally happens</span>{' '}
                row is the unconditional baseline: every window of that length
                in the same lookback, condition or not, measured identically —
                all {coverage.bars.toLocaleString()} sessions, not a sample.
              </p>
              <p>
                It includes the early sessions where this condition could not
                yet fire — a 200-day average and a 52-week high need a year of
                history before they exist. It is therefore identical under every
                table on this page, which is what makes the conditions
                comparable with each other.
              </p>
              <p>{EPISODE_NOTE}</p>
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
