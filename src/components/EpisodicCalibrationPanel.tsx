import type { EpisodicCalibration } from '@/lib/episodic/types';
import { GRID_GAP_PCTS, GRID_VOLUME_MULTS } from '@/lib/episodic/types';

/**
 * The backfill calibration read-out.
 *
 * A server component — pure display of the counts the historical run produced,
 * so the reader can answer "how often does this fire, where do candidates die,
 * and is the base-trend filter cutting good setups" without opening the data.
 * Counts only; nothing here is about whether a setup made money (deliberately
 * out of scope).
 */
export function EpisodicCalibrationPanel({ cal }: { cal: EpisodicCalibration }) {
  const months = Object.keys(cal.perMonth).sort();
  const maxMonth = Math.max(1, ...Object.values(cal.perMonth));
  const perMonthAvg = cal.months > 0 ? cal.findingsTotal / cal.months : 0;
  const perWeekAvg = perMonthAvg / 4.33;

  // The count at the shipped defaults (5% / 5×), read from the grid — distinct
  // from findingsTotal, which is the looser capture set the board browses.
  const defaultCount = cal.grid['5']?.['5'] ?? 0;

  const f = cal.yearFunnel;
  const funnelRows: Array<[string, number]> = [
    ['Candidate gap-days (cleared gap %, close, volume, dollar at 4% / 3×)', f.candidateGapDays],
    ['— dropped: illiquid at the time', f.droppedLiquidity],
    ['— dropped: not fresh (earlier gap in the base)', f.droppedNotFresh],
    ['— dropped: base price range too wide', f.droppedBaseTooWide],
    ['— dropped: base already trending up', f.droppedBaseTrending],
    ['— dropped: base volume already rising (2× rule)', f.droppedBaseVolRising],
    ['Findings at the defaults', f.findings],
  ];
  const biggestDropLabel = (
    [
      ['illiquid', f.droppedLiquidity],
      ['not fresh', f.droppedNotFresh],
      ['base too wide', f.droppedBaseTooWide],
      ['base trending', f.droppedBaseTrending],
      ['base volume rising', f.droppedBaseVolRising],
    ] as Array<[string, number]>
  ).reduce((best, r) => (r[1] > best[1] ? r : best), ['none', 0] as [string, number]);

  return (
    <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="label-xs text-term-text">Backfill calibration</h2>
        <span className="text-term-faint">
          {cal.months} months from {cal.fromDate}
          {cal.complete ? '' : ' · PARTIAL PASS'}
        </span>
      </div>

      {/* How often it fires. */}
      <p className="mt-2 text-term-dim">
        <span className="font-bold text-term-text">{cal.findingsTotal}</span> findings over{' '}
        {cal.months} months at the capture envelope (the browsable set below) — about{' '}
        <span className="font-bold text-term-text">{perMonthAvg.toFixed(1)}/month</span> (~
        {perWeekAvg.toFixed(1)}/week). At the shipped defaults (5% / 5×) it is{' '}
        <span className="font-bold text-term-text">{defaultCount}</span> over the year (~
        {(defaultCount / Math.max(cal.months, 1)).toFixed(1)}/month). So: a couple a week at the
        capture net, a couple a <em>month</em> at the defaults — not 2 a day, not 2 a quarter.
      </p>

      {/* Findings per month, a plain bar list. */}
      <div className="mt-2">
        <h3 className="label-xs">Findings per month</h3>
        <ul className="mt-1 space-y-0.5">
          {months.length === 0 && <li className="text-term-faint">No findings in the window.</li>}
          {months.map((m) => (
            <li key={m} className="flex items-center gap-2 tabular-nums">
              <span className="w-16 shrink-0 text-term-dim">{m}</span>
              <span
                className="inline-block h-2 bg-pos/50"
                style={{ width: `${(cal.perMonth[m] / maxMonth) * 60}%` }}
                aria-hidden
              />
              <span className="text-term-dim">{cal.perMonth[m]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* The funnel over the whole window. */}
      <div className="mt-3">
        <h3 className="label-xs">Where candidates died, over the whole window</h3>
        <ul className="mt-1 space-y-0.5 tabular-nums">
          {funnelRows.map(([label, n]) => (
            <li key={label} className="flex justify-between gap-4">
              <span>{label}</span>
              <span className="text-term-dim">{n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-term-dim">
          Biggest single killer: <span className="text-term-text">{biggestDropLabel[0]}</span> (
          {biggestDropLabel[1]} of {f.candidateGapDays} candidates).
        </p>
      </div>

      {/* Base-trend filter cost. */}
      <div className="mt-3">
        <h3 className="label-xs">Base-trend filter cost</h3>
        <p className="mt-1 text-term-dim">
          Kept <span className="font-bold text-term-text">{cal.trendKept}</span> findings; the
          filter removed <span className="font-bold text-term-text">{cal.trendRemoved}</span>{' '}
          would-be findings (those that failed only the trend test). Without the filter the count
          would be <span className="font-bold text-term-text">{cal.trendKept + cal.trendRemoved}</span>.
          The removed ones are listed below — eyeball whether they are really rising channels.
        </p>
      </div>

      {/* Sensitivity grid. */}
      <div className="mt-3">
        <h3 className="label-xs">Finding count by gap % (rows) × volume × (cols)</h3>
        <div className="mt-1 overflow-x-auto">
          <table className="border-collapse text-2xs tabular-nums">
            <thead>
              <tr className="text-term-faint">
                <th className="px-2 py-1 text-left font-bold">gap ≥</th>
                {GRID_VOLUME_MULTS.map((v) => (
                  <th key={v} className="px-2 py-1 text-right font-bold">
                    {v}×
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GRID_GAP_PCTS.map((g) => {
                const gk = String(Math.round(g * 100));
                return (
                  <tr key={gk} className="border-t border-term-line/60">
                    <td className="px-2 py-1 text-term-dim">{gk}%</td>
                    {GRID_VOLUME_MULTS.map((v) => (
                      <td key={v} className="px-2 py-1 text-right text-term-dim">
                        {cal.grid[gk]?.[String(v)] ?? 0}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-term-faint">
          Counts only — other rules held at their defaults. The shipped defaults are 5% / 5×.
        </p>
      </div>
    </section>
  );
}
