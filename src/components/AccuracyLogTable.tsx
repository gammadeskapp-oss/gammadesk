import { formatPrice, formatStrike, formatUsd } from '@/lib/format';
import { formatExpiryLabel } from '@/lib/time';
import { MATCH_LABEL, matchStatus } from '@/lib/log/types';
import type { AccuracyStats, LogEntry } from '@/lib/log/types';

function Stat({
  value,
  label,
  tone = 'neutral',
}: {
  value: string;
  label: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'flip';
}) {
  const colour = {
    neutral: 'text-term-text',
    pos: 'text-pos',
    neg: 'text-neg',
    flip: 'text-flip',
  }[tone];
  const edge = {
    neutral: 'border-term-line',
    pos: 'border-pos/40',
    neg: 'border-neg/40',
    flip: 'border-flip/40',
  }[tone];

  return (
    <div className={`panel border-l-2 px-3.5 py-2.5 ${edge}`}>
      <div className={`text-lg font-bold tabular-nums ${colour}`}>{value}</div>
      <div className="label-xs mt-1">{label}</div>
    </div>
  );
}

function Outcome({ entry }: { entry: LogEntry }) {
  if (!entry.settled) {
    return <span className="text-term-faint">pending</span>;
  }
  if (entry.flipOutcome === 'held') {
    return <span className="font-bold text-pos">HELD</span>;
  }
  if (entry.flipOutcome === 'broke') {
    return <span className="font-bold text-neg">BROKE</span>;
  }
  return <span className="text-term-faint">n/a</span>;
}

function Magnet({ entry }: { entry: LogEntry }) {
  if (!entry.settled) return <span className="text-term-faint">pending</span>;

  switch (entry.magnetTouched) {
    case 'both':
      return <span className="font-bold text-pos">BOTH</span>;
    case 'above':
      return <span className="font-bold text-pos">ABOVE</span>;
    case 'below':
      return <span className="font-bold text-pos">BELOW</span>;
    case 'none':
      return <span className="text-term-faint">none</span>;
    default:
      return <span className="text-term-faint">n/a</span>;
  }
}

/**
 * The plain reading of the day, in words rather than in flags.
 *
 * A miss is styled as legibly as a hit — same weight, same size, only the
 * colour differs. A record that renders its failures in grey mouse type is
 * telling the reader something untrue about itself.
 */
function Status({ entry }: { entry: LogEntry }) {
  const status = matchStatus(entry);
  if (status === null) {
    return (
      <span className="text-term-faint">
        {entry.settled ? 'not judged' : 'pending'}
      </span>
    );
  }
  const tone = {
    mostly: 'text-pos',
    partially: 'text-flip',
    none: 'text-neg',
  }[status];
  return <span className={`font-bold ${tone}`}>{MATCH_LABEL[status]}</span>;
}

interface Props {
  entries: LogEntry[];
  stats: AccuracyStats;
}

export function AccuracyLogTable({ entries, stats }: Props) {
  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`);

  const head =
    'sticky top-0 z-20 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';

  return (
    <div className="space-y-4">
      <section
        aria-label="Running accuracy"
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
      >
        <Stat
          value={pct(stats.flipHeldPct)}
          label={`flip held · ${stats.flipHeld}/${stats.flipJudged} days`}
          tone={
            stats.flipHeldPct === null
              ? 'neutral'
              : stats.flipHeldPct >= 50
                ? 'pos'
                : 'neg'
          }
        />
        <Stat
          value={pct(stats.magnetTouchedPct)}
          label={`magnet touched · ${stats.magnetTouched}/${stats.magnetJudged} days`}
          tone="flip"
        />
        <Stat value={String(stats.daysTracked)} label="days tracked" />
        <Stat
          value={String(stats.daysTracked - stats.daysSettled)}
          label="awaiting settlement"
          tone="neutral"
        />
      </section>

      {entries.length === 0 ? (
        <div className="panel px-4 py-10 text-center text-xs text-term-dim">
          <p className="text-term-text">No trading days recorded yet.</p>
          <p className="mt-2">
            A snapshot is taken each weekday morning and settled after the close.
            The first row will appear after the next scheduled run.
          </p>
        </div>
      ) : (
        <div className="panel">
          <div className="scroll-term max-h-[70vh] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
              <caption className="sr-only">
                Daily record of gamma regime, flip level and magnet strikes
                against the session that followed.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={`${head} sticky left-0 z-30 text-left`}>
                    Date
                  </th>
                  <th scope="col" className={head}>Regime</th>
                  <th scope="col" className={head}>Flip</th>
                  <th scope="col" className={head}>Spot @ snap</th>
                  <th scope="col" className={head}>Net GEX</th>
                  <th scope="col" className={head}>Magnet ↑</th>
                  <th scope="col" className={head}>Magnet ↓</th>
                  <th scope="col" className={head}>Day L — H</th>
                  <th scope="col" className={head}>Close</th>
                  <th scope="col" className={`${head} border-l border-term-edge`}>
                    Flip
                  </th>
                  <th scope="col" className={head}>Magnet</th>
                  <th scope="col" className={`${head} text-left`}>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const cell = 'whitespace-nowrap border-b border-term-line/60 px-2.5 py-1.5';
                  return (
                    <tr key={e.date} className={e.settled ? '' : 'bg-flip/[0.04]'}>
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 bg-term-panel text-left font-bold text-term-dim ${cell}`}
                      >
                        {formatExpiryLabel(e.date)}
                        <span className="ml-1 font-normal text-term-faint">
                          {e.date.slice(0, 4)}
                        </span>
                      </th>
                      <td
                        className={`${cell} font-bold ${
                          e.regime === 'positive' ? 'text-pos' : 'text-neg'
                        }`}
                      >
                        {e.regime === 'positive' ? 'POS' : 'NEG'}
                      </td>
                      <td className={`${cell} text-flip`}>
                        {e.flipLevel === null ? '—' : formatPrice(e.flipLevel)}
                      </td>
                      <td className={`${cell} text-term-text`}>
                        {formatPrice(e.spotAtSnapshot)}
                      </td>
                      <td
                        className={`${cell} ${e.netGex >= 0 ? 'text-pos' : 'text-neg'}`}
                      >
                        {formatUsd(e.netGex)}
                      </td>
                      <td className={`${cell} text-term-dim`}>
                        {e.magnetAbove === null ? '—' : formatStrike(e.magnetAbove)}
                      </td>
                      <td className={`${cell} text-term-dim`}>
                        {e.magnetBelow === null ? '—' : formatStrike(e.magnetBelow)}
                      </td>
                      <td className={`${cell} text-term-dim`}>
                        {e.settled && e.low !== undefined && e.high !== undefined
                          ? `${formatPrice(e.low)} — ${formatPrice(e.high)}`
                          : '—'}
                      </td>
                      <td className={`${cell} text-term-text`}>
                        {e.settled && e.close !== undefined
                          ? formatPrice(e.close)
                          : '—'}
                      </td>
                      <td className={`${cell} border-l border-term-edge`}>
                        <Outcome entry={e} />
                      </td>
                      <td className={cell}>
                        <Magnet entry={e} />
                      </td>
                      <td className={`${cell} text-left`}>
                        <Status entry={e} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
