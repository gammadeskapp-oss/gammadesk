import type { PathsView } from '@/lib/analogues';

/**
 * Every episode's actual path, rebased to 100 on the day the pattern finished.
 *
 * ## What this is for
 *
 * The table gives a typical result. It cannot say whether that typical result
 * describes most of the episodes or is being dragged around by two of them.
 * This does: one thin line per episode, and a reader can see at a glance
 * whether the bundle is tight or whether the middle of it is an average of
 * one line going up 30% and another going down 25%.
 *
 * ## Nothing is smoothed, clipped or winsorised
 *
 * 2008 and 2020 fly off the top and bottom, and that is the point. A chart
 * that tidied the extremes away would answer the opposite question to the one
 * being asked, and would do it while looking more trustworthy.
 *
 * ## One line per episode, never per occurrence
 *
 * See `episodes.ts`. Drawing all 448 occurrences would draw March 2020 a dozen
 * times over and make a handful of stretches look like hundreds of independent
 * confirmations.
 *
 * Server-rendered SVG with `<title>` on the extremes, so the year is available
 * on hover and to a screen reader without shipping any JavaScript.
 */

const W = 900;
const H = 320;
const PAD = { top: 14, right: 54, bottom: 26, left: 12 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export function AnaloguePathsChart({
  paths,
  symbol,
  label,
}: {
  paths: PathsView;
  symbol: string;
  label: string;
}) {
  const { paths: lines, band } = paths;
  if (lines.length === 0 || band.length === 0) return null;

  const maxDay = band[band.length - 1].day || 1;

  // The scale covers every line, extremes included — clipping one would be the
  // single most misleading thing this chart could do.
  let lo = 100;
  let hi = 100;
  for (const line of lines) {
    for (const value of line.values) {
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;

  const x = (day: number) => PAD.left + (day / maxDay) * PLOT_W;
  const y = (value: number) =>
    PAD.top + ((hi - value) / (hi - lo || 1)) * PLOT_H;

  const toPoints = (values: number[]) =>
    values.map((v, day) => `${x(day).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const bandArea =
    band.map((b) => `${x(b.day).toFixed(1)},${y(b.p75).toFixed(1)}`).join(' ') +
    ' ' +
    [...band]
      .reverse()
      .map((b) => `${x(b.day).toFixed(1)},${y(b.p25).toFixed(1)}`)
      .join(' ');

  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v * 10) / 10);
  const dayTicks = [0, 5, 10, 21, 42].filter((d) => d <= maxDay);

  const extremeYears = new Set(
    [paths.bestYear, paths.worstYear].filter((y): y is string => y !== null),
  );

  return (
    <figure className="panel space-y-2 overflow-x-auto px-4 py-3">
      <figcaption className="text-2xs leading-relaxed text-term-dim">
        Each thin line is one separate stretch of market, starting at 100 on the
        day the pattern finished. The darker line is the middle one; the shaded
        band holds the middle half. Nothing is smoothed or trimmed — the
        extremes are the point.
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[620px]"
        role="img"
        aria-label={`${lines.length} separate stretches of ${symbol} after ${label}, each rebased to 100 on the day the pattern finished and followed for ${maxDay} trading days.`}
      >
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(value)}
              y2={y(value)}
              className="stroke-term-line"
              strokeWidth={1}
            />
            <text
              x={PAD.left + PLOT_W + 6}
              y={y(value) + 3}
              className="fill-term-faint"
              fontSize={9}
            >
              {value.toFixed(0)}
            </text>
          </g>
        ))}

        {/* The starting level, so up and down are readable without arithmetic. */}
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={y(100)}
          y2={y(100)}
          className="stroke-term-edge"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {dayTicks.map((day) => (
          <text
            key={day}
            x={x(day)}
            y={H - 6}
            className="fill-term-faint"
            fontSize={9}
            textAnchor="middle"
          >
            {day === 0 ? 'day 0' : `${day}d`}
          </text>
        ))}

        <polygon points={bandArea} className="fill-flip" opacity={0.12} />

        {lines.map((line) => {
          const isExtreme = extremeYears.has(line.year) &&
            (line.year === paths.bestYear || line.year === paths.worstYear);
          return (
            <polyline
              key={`${line.date}`}
              points={toPoints(line.values)}
              fill="none"
              className={isExtreme ? 'stroke-flip' : 'stroke-term-faint'}
              strokeWidth={isExtreme ? 1.2 : 0.7}
              opacity={isExtreme ? 0.85 : 0.4}
            >
              {/* Hover and screen-reader label. Extremes name their year. */}
              <title>
                {line.date}
                {line.occurrences > 1 ? ` · ${line.occurrences} occurrences` : ''}
                {` · finished at ${line.endValue.toFixed(1)}`}
              </title>
            </polyline>
          );
        })}

        <polyline
          points={band.map((b) => `${x(b.day).toFixed(1)},${y(b.median).toFixed(1)}`).join(' ')}
          fill="none"
          className="stroke-term-text"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>

      <p className="text-2xs text-term-faint">
        {lines.length} separate {lines.length === 1 ? 'stretch' : 'stretches'}{' '}
        drawn
        {paths.bestYear && paths.worstYear && (
          <>
            {' '}· the highest finish was in {paths.bestYear} and the lowest in{' '}
            {paths.worstYear}, both drawn in amber
          </>
        )}
        . Hover any line for its date.
      </p>
    </figure>
  );
}
