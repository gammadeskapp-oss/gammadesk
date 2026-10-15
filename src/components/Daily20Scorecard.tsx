import {
  HORIZONS,
  type Breakdown,
  type Horizon,
  type HorizonStat,
  type Scorecard,
} from '@/lib/scanner/daily20Scorecard';

/**
 * The Daily 20 scorecard — what the list did next, reported as a hit rate AND a
 * median return, with the breakdowns that keep it honest. Not a win-rate
 * headline: both numbers are shown, the sign of the median is preserved, and it
 * is empty until enough sessions have matured.
 */

function fmtPct(frac: number | null): string {
  if (frac === null || !Number.isFinite(frac)) return '—';
  const v = frac * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function fmtRate(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : `${Math.round(v)}%`;
}

const cell = 'px-2.5 py-1 text-right tabular-nums';
const head = 'px-2.5 py-1 text-right text-2xs uppercase tracking-[0.1em] text-term-faint';

function OverallTable({ overall }: { overall: Record<Horizon, HorizonStat> }) {
  return (
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr>
          <th className={`${head} text-left`}>Horizon</th>
          <th className={head}>N</th>
          <th className={head}>Hit rate</th>
          <th className={head}>Median</th>
          <th className={head}>Mean</th>
        </tr>
      </thead>
      <tbody>
        {HORIZONS.map((h) => {
          const s = overall[h];
          return (
            <tr key={h}>
              <th scope="row" className="px-2.5 py-1 text-left font-bold text-term-text">{h}d</th>
              <td className={`${cell} text-term-dim`}>{s.n}</td>
              <td className={`${cell} text-term-text`}>{fmtRate(s.hitRate)}</td>
              <td className={`${cell} ${(s.median ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtPct(s.median)}</td>
              <td className={`${cell} text-term-dim`}>{fmtPct(s.mean)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="label-xs mb-1">{title}</h3>
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className={`${head} text-left`}>Slice</th>
            <th className={head}>N</th>
            <th className={head}>5d hit</th>
            <th className={head}>5d med</th>
            <th className={head}>20d hit</th>
            <th className={head}>20d med</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.key}>
              <th scope="row" className="px-2.5 py-1 text-left text-term-dim">{b.label}</th>
              <td className={`${cell} text-term-faint`}>{b.n}</td>
              <td className={`${cell} text-term-text`}>{fmtRate(b.byHorizon[5].hitRate)}</td>
              <td className={`${cell} ${(b.byHorizon[5].median ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtPct(b.byHorizon[5].median)}</td>
              <td className={`${cell} text-term-text`}>{fmtRate(b.byHorizon[20].hitRate)}</td>
              <td className={`${cell} ${(b.byHorizon[20].median ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtPct(b.byHorizon[20].median)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Daily20Scorecard({ scorecard }: { scorecard: Scorecard }) {
  return (
    <section className="panel px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-term-text">
          Daily 20 scorecard
        </h2>
        <span className="text-2xs text-term-faint">
          What the list did next — hit rate AND median, close-to-close, direction-aware. Not a
          win-rate headline.
        </span>
      </div>

      {scorecard.sampled === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-term-dim">
          No matured sessions yet. The scorecard records each session&rsquo;s Daily 20 and measures its
          forward returns at 1 / 5 / 10 / 20 sessions, so it fills in as sessions are recorded and
          the windows mature — it is deliberately empty rather than showing a number with no
          sample behind it.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <OverallTable overall={scorecard.overall} />
              <p className="mt-1.5 text-2xs text-term-faint">
                {scorecard.sampled} listings sampled · MFE median {fmtPct(scorecard.mfeMedian)} ·
                MAE median {fmtPct(scorecard.maeMedian)} (over 20 sessions, from closes).
              </p>
            </div>
            <div className="space-y-3">
              <BreakdownTable title="By gamma regime" rows={scorecard.byRegime} />
              <BreakdownTable title="Leaders vs laggards" rows={scorecard.byDirection} />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownTable title="By setup" rows={scorecard.bySetup} />
            <div className="space-y-3">
              <BreakdownTable title="New entry vs continuing" rows={scorecard.byNewVsContinuing} />
              <BreakdownTable title="Post-'extended' warning" rows={scorecard.byExtended} />
            </div>
          </div>
          <BreakdownTable title="By sector" rows={scorecard.bySector} />
          <p className="text-2xs leading-relaxed text-term-faint">
            A &ldquo;hit&rdquo; is a move the listed way — up for a leader, down for a laggard. The
            median return keeps its sign. Returns are close-to-close; MFE/MAE are from daily closes,
            not intraday highs. Nothing here predicts the next session.
          </p>
        </div>
      )}
    </section>
  );
}
