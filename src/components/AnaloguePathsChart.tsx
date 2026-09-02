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

  /*
   * The 100 line is always labelled, so any tick that would land on top of it
   * is dropped rather than printed over it — on a tight bundle the midpoint
   * sits within a few pixels of 100 and the two labels collide.
   */
  const ticks = [lo, (lo + hi) / 2, hi]
    .map((v) => Math.round(v * 10) / 10)
    .filter((v) => Math.abs(y(v) - y(100)) > 10);
  const dayTicks = [0, 5, 10, 21, 42].filter((d) => d <= maxDay);

  /*
   * The two extreme paths, by date. Matching on year lit every episode that
   * shared a calendar year with an extreme — on a 155-line chart that was a
   * dozen amber lines claiming to be two.
   */
  const extremeDates = new Set(
    [paths.bestDate, paths.worstDate].filter((d): d is string => d !== null),
  );

  /*
   * Per-line opacity falls as the bundle grows, so density reads as density
   * rather than as a solid block. Twenty episodes stay individually legible;
   * a hundred and fifty overlap into shading that still shows where the mass
   * is. Floored so no line disappears entirely.
   */
  const lineOpacity = Math.max(0.09, Math.min(0.4, 12 / lines.length));

  const ordinary = lines.filter((l) => !extremeDates.has(l.date));
  const extremes = lines.filter((l) => extremeDates.has(l.date));

  return (
    <figure className="panel space-y-2 overflow-x-auto px-4 py-3">
      <figcaption className="text-2xs leading-relaxed text-term-dim">
        Each thin line is one separate stretch of market, starting at 100 on the
        day the pattern finished. The solid white line is the middle one, and
        the dashed lines around it hold the middle half. Nothing is smoothed or
        trimmed — the extremes are the point.
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
        <text
          x={PAD.left + PLOT_W + 6}
          y={y(100) + 3}
          className="fill-term-dim"
          fontSize={9}
        >
          100
        </text>

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

        {/*
          The middle half. Under every line so the bundle is never hidden, but
          its edges are drawn explicitly on top — at a hundred and fifty lines
          a fill alone is indistinguishable from the bundle sitting on it, and
          the caption promises a band the reader could not find.
        */}
        <polygon points={bandArea} className="fill-term-text" opacity={0.14} />

        {ordinary.map((line) => (
          <polyline
            key={line.date}
            points={toPoints(line.values)}
            fill="none"
            className="stroke-term-faint"
            strokeWidth={0.6}
            opacity={lineOpacity}
          >
            <title>
              {line.date}
              {line.occurrences > 1 ? ` · ${line.occurrences} occurrences` : ''}
              {` · finished at ${line.endValue.toFixed(1)}`}
            </title>
          </polyline>
        ))}

        {/* Drawn after the bundle so they are not buried inside it. */}
        {extremes.map((line) => (
          <polyline
            key={line.date}
            points={toPoints(line.values)}
            fill="none"
            className="stroke-flip"
            strokeWidth={1.4}
            opacity={0.95}
          >
            <title>
              {line.date}
              {line.occurrences > 1 ? ` · ${line.occurrences} occurrences` : ''}
              {` · finished at ${line.endValue.toFixed(1)}`}
            </title>
          </polyline>
        ))}

        {([
          ['p25', band.map((b) => `${x(b.day).toFixed(1)},${y(b.p25).toFixed(1)}`)],
          ['p75', band.map((b) => `${x(b.day).toFixed(1)},${y(b.p75).toFixed(1)}`)],
        ] as const).map(([key, points]) => (
          <polyline
            key={key}
            points={points.join(' ')}
            fill="none"
            className="stroke-term-text"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.5}
          />
        ))}

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
            {' '}· the highest finish was {paths.bestDate} and the lowest{' '}
            {paths.worstDate}, the two amber lines
          </>
        )}
        . Hover any line for its date.
      </p>
    </figure>
  );
}
