import type { Bar, Match } from '@/lib/analogues';

/**
 * The whole stored price history, with every match marked on the session it
 * belongs to.
 *
 * ## Log scale, not linear
 *
 * Thirty years of SPY on a linear axis is a flat line for the first twenty
 * years and a wall for the last five, which would hide every match before
 * about 2015 in a band a few pixels tall. A log axis gives a 5% move the same
 * height wherever it happens, which is the only way a count of matches spread
 * across decades can be read as evenly distributed or clustered — and spotting
 * that clustering by eye is the reason the chart is here at all.
 *
 * ## Hand-drawn SVG, server-rendered
 *
 * Same reasoning as `HistoryChart`: this needs no interaction, and rendering
 * it on the server means the marks cannot flash in late or disagree with the
 * counts printed beside them.
 *
 * The close line is downsampled for drawing only. Match marks are placed from
 * the true index, so a mark is never nudged onto a neighbouring session.
 */

const W = 960;
const H = 300;
const PAD = { top: 12, right: 52, bottom: 22, left: 10 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** At most one point per horizontal pixel — more is invisible and costly. */
const MAX_POINTS = PLOT_W;

export function AnalogueChart({
  bars,
  matches,
  symbol,
  label,
}: {
  bars: Bar[];
  matches: Match[];
  symbol: string;
  label: string;
}) {
  if (bars.length < 2) return null;

  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  // Guarded rather than assumed: a non-positive close would make the log
  // undefined, and a zero span would divide by zero.
  const loRaw = min > 0 ? min : 0.01;
  const hiRaw = max > loRaw ? max : loRaw * 1.01;
  const lo = Math.log(loRaw);
  const hi = Math.log(hiRaw);
  const span = hi - lo || 1;

  const x = (index: number) =>
    PAD.left + (index / (bars.length - 1)) * PLOT_W;
  const y = (price: number) =>
    PAD.top + ((hi - Math.log(price > 0 ? price : loRaw)) / span) * PLOT_H;

  const step = Math.max(1, Math.ceil(bars.length / MAX_POINTS));
  const points: string[] = [];
  for (let i = 0; i < bars.length; i += step) {
    points.push(`${x(i).toFixed(1)},${y(closes[i]).toFixed(1)}`);
  }
  // The last bar is always drawn, whatever the step lands on.
  const lastIndex = bars.length - 1;
  points.push(`${x(lastIndex).toFixed(1)},${y(closes[lastIndex]).toFixed(1)}`);

  /** Four price labels, spaced evenly in log space to match the axis. */
  const ticks = Array.from({ length: 4 }, (_, i) =>
    Math.exp(lo + (span * i) / 3),
  );

  /** A year label roughly every eighth of the width. */
  const yearStep = Math.max(1, Math.floor(bars.length / 8));
  const yearMarks: { index: number; year: string }[] = [];
  for (let i = 0; i < bars.length; i += yearStep) {
    yearMarks.push({ index: i, year: bars[i].date.slice(0, 4) });
  }

  return (
    <div className="panel overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[640px]"
        role="img"
        aria-label={`${symbol} closing price from ${bars[0].date} to ${bars[lastIndex].date} on a log scale, with ${matches.length} sessions that completed ${label} marked.`}
      >
        {ticks.map((price) => (
          <g key={price}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(price)}
              y2={y(price)}
              className="stroke-term-line"
              strokeWidth={1}
            />
            <text
              x={PAD.left + PLOT_W + 6}
              y={y(price) + 3}
              className="fill-term-faint"
              fontSize={9}
            >
              {price >= 100 ? price.toFixed(0) : price.toFixed(2)}
            </text>
          </g>
        ))}

        {yearMarks.map((mark) => (
          <text
            key={mark.index}
            x={x(mark.index)}
            y={H - 6}
            className="fill-term-faint"
            fontSize={9}
            textAnchor="middle"
          >
            {mark.year}
          </text>
        ))}

        {/*
          Marks under the price line, so a dense cluster never buries the
          series it is supposed to be annotating.
        */}
        {matches.map((match) => (
          <line
            key={match.date}
            x1={x(match.index)}
            x2={x(match.index)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            className="stroke-flip"
            strokeWidth={1}
            // Individually faint so that overlapping marks accumulate into a
            // visibly darker band exactly where the matches cluster.
            opacity={0.28}
          />
        ))}

        <polyline
          points={points.join(' ')}
          fill="none"
          className="stroke-term-text"
          strokeWidth={1}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
