import type { HistoryDay } from '@/lib/history';

/**
 * Thirty sessions of candles, with each day's recorded levels drawn as short
 * marks on that day alone.
 *
 * ## Why this is hand-drawn SVG and not the charting library
 *
 * The rest of the site uses lightweight-charts, and this deliberately does
 * not. The whole point of the drawing is that a level belongs to one session:
 * it was recorded that morning and it says nothing about any other day.
 * Lightweight-charts draws price lines across the full width, which is exactly
 * the claim being avoided — a flip level from three weeks ago extended to
 * today would assert a continuity the data does not have.
 *
 * Server-rendered, so it needs no JavaScript and cannot flash an empty canvas.
 */

const W = 960;
const H = 380;
const PAD = { top: 14, right: 56, bottom: 26, left: 10 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Share of a day's column width that a level mark spans. */
const MARK_WIDTH = 0.82;

export function HistoryChart({
  days,
  symbol,
}: {
  days: HistoryDay[];
  symbol: string;
}) {
  if (days.length === 0) return null;

  /*
   * The scale has to cover the levels as well as the bars. A level recorded
   * above the whole window's range is a real and interesting thing — it means
   * price never went near it — and clipping it off the top would hide exactly
   * that.
   */
  const values: number[] = [];
  for (const day of days) {
    values.push(day.bar.high, day.bar.low);
    for (const level of [day.flip, day.stall ?? day.magnetAbove, day.bounce ?? day.magnetBelow]) {
      if (level !== null) values.push(level);
    }
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = span * 0.04;
  const lo = min - pad;
  const hi = max + pad;

  const y = (price: number) => PAD.top + ((hi - price) / (hi - lo)) * PLOT_H;
  const colWidth = PLOT_W / days.length;
  const cx = (i: number) => PAD.left + colWidth * (i + 0.5);

  /** Five evenly spaced price labels down the right edge. */
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  return (
    <div className="panel overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[640px]"
        role="img"
        aria-label={`${symbol} daily candles for the last ${days.length} sessions, with each day's recorded dealer levels marked on that day only.`}
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
              fontSize={10}
            >
              {price.toFixed(0)}
            </text>
          </g>
        ))}

        {days.map((day, i) => {
          const x = cx(i);
          const up = day.bar.close >= day.bar.open;
          const bodyTop = y(Math.max(day.bar.open, day.bar.close));
          const bodyBottom = y(Math.min(day.bar.open, day.bar.close));
          const bodyW = Math.max(2, colWidth * 0.55);
          const markW = colWidth * MARK_WIDTH;

          const stall = day.stall ?? day.magnetAbove;
          const bounce = day.bounce ?? day.magnetBelow;

          return (
            <g key={day.date}>
              {/* wick */}
              <line
                x1={x}
                x2={x}
                y1={y(day.bar.high)}
                y2={y(day.bar.low)}
                className={up ? 'stroke-bull' : 'stroke-bear'}
                strokeWidth={1}
              />
              {/* body — a doji still needs a visible line */}
              <rect
                x={x - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={Math.max(1, bodyBottom - bodyTop)}
                className={up ? 'fill-bull' : 'fill-bear'}
                opacity={0.85}
              />

              {/*
                The levels for THIS session only. Dashed, and deliberately
                wider than the candle body so they read as a separate layer
                rather than as part of the bar.
              */}
              {stall !== null && (
                <line
                  x1={x - markW / 2}
                  x2={x + markW / 2}
                  y1={y(stall)}
                  y2={y(stall)}
                  className="stroke-bear"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  opacity={0.9}
                />
              )}
              {bounce !== null && (
                <line
                  x1={x - markW / 2}
                  x2={x + markW / 2}
                  y1={y(bounce)}
                  y2={y(bounce)}
                  className="stroke-bull"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  opacity={0.9}
                />
              )}
              {day.flip !== null && (
                <line
                  x1={x - markW / 2}
                  x2={x + markW / 2}
                  y1={y(day.flip)}
                  y2={y(day.flip)}
                  className="stroke-flip"
                  strokeWidth={1.5}
                  opacity={0.95}
                />
              )}

              {/* Date labels every fifth column, so they never collide. */}
              {i % 5 === 0 && (
                <text
                  x={x}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-term-faint"
                  fontSize={9}
                >
                  {day.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-term-line px-3.5 py-2.5 text-2xs text-term-faint">
        <Key className="bg-bear" dashed>
          Resistance / hedging response area
        </Key>
        <Key className="bg-bull" dashed>
          Support / hedging response area
        </Key>
        <Key className="bg-flip">Gamma flip</Key>
        <span>
          Each mark spans only the session it was recorded for. Nothing is
          carried across the chart.
        </span>
      </div>
    </div>
  );
}

function Key({
  className,
  dashed,
  children,
}: {
  className: string;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={`inline-block h-0.5 w-5 ${className} ${dashed ? 'opacity-70' : ''}`}
      />
      {children}
    </span>
  );
}
