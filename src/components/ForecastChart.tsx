import { config } from '@/lib/config';
import { formatPrice, formatUsd } from '@/lib/format';
import type { ForecastResult, MagnetStrike } from '@/lib/forecast/types';

/**
 * The forecast cone, rendered as plain SVG on the server.
 *
 * No charting library and no client JavaScript: the whole thing is static
 * geometry, so it costs nothing to hydrate and renders identically everywhere.
 * Even the "show all strikes" toggle is CSS — see `.gd-forecast` in globals.css.
 */

const W = 1000;
const H = 430;
const M = { top: 16, right: 58, bottom: 30, left: 12 };

/* Mirrors the CSS variables in globals.css; SVG attributes cannot read them. */
const COLOR = {
  history: '#f0a500', // brand amber — the realised path
  band95: 'rgba(61, 220, 132, 0.10)',
  band68: 'rgba(61, 220, 132, 0.22)',
  median: '#3ddc84',
  attractor: '#3ddc84',
  repeller: '#ff5c7a',
  grid: '#1a2133',
  axis: '#5a687d',
  spot: '#8494a8', // neutral, so it does not compete with the amber history
};

export function ForecastChart({ data }: { data: ForecastResult }) {
  const { history, bands, spot, magnets, horizon } = data;

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  // x runs over historical sessions then forward days; index 0..total-1.
  const total = history.length + horizon;
  const x = (i: number) => M.left + (i / Math.max(1, total - 1)) * plotW;

  // The cone emanates from today's price, so day 0 is pinned to spot.
  const forward = [
    { day: 0, p2_5: spot, p16: spot, p50: spot, p84: spot, p97_5: spot },
    ...bands,
  ];
  const originIndex = history.length - 1;

  // --- y scale ---------------------------------------------------------------
  const values: number[] = [
    ...history.map((h) => h.close),
    ...bands.map((b) => b.p2_5),
    ...bands.map((b) => b.p97_5),
    spot,
  ];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;

  const y = (price: number) =>
    M.top + plotH - ((price - lo) / (hi - lo)) * plotH;

  // --- paths -----------------------------------------------------------------
  const historyPath = history
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(h.close).toFixed(2)}`)
    .join(' ');

  const forwardX = (day: number) => x(originIndex + day);

  const bandArea = (
    upper: (b: (typeof forward)[number]) => number,
    lower: (b: (typeof forward)[number]) => number,
  ) => {
    const top = forward
      .map((b, i) => `${i === 0 ? 'M' : 'L'}${forwardX(b.day).toFixed(2)},${y(upper(b)).toFixed(2)}`)
      .join(' ');
    const bottom = [...forward]
      .reverse()
      .map((b) => `L${forwardX(b.day).toFixed(2)},${y(lower(b)).toFixed(2)}`)
      .join(' ');
    return `${top} ${bottom} Z`;
  };

  const medianPath = forward
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${forwardX(b.day).toFixed(2)},${y(b.p50).toFixed(2)}`)
    .join(' ');

  // --- axis ticks ------------------------------------------------------------
  const yTicks = Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5);

  const xTicks: Array<{ i: number; label: string }> = [];
  const historyStep = Math.max(1, Math.floor(history.length / 4));
  for (let i = 0; i < history.length; i += historyStep) {
    xTicks.push({ i, label: history[i].date.slice(5) });
  }
  for (const day of [5, 10, 15, 20]) {
    if (day <= horizon) xTicks.push({ i: originIndex + day, label: `+${day}d` });
  }

  // --- magnet markers --------------------------------------------------------
  // The field carries every significant strike for every expiry, so plotting it
  // raw is one dot per strike per day — hundreds of them, all overlapping. The
  // default view keeps only the strongest attractor and the strongest repeller
  // per expiry and drops strikes too small to matter against the whole chain.
  // "Show all strikes" brings the raw field back.

  const inFrame = (s: MagnetStrike) => s.strike >= lo && s.strike <= hi;
  const inHorizon = magnets.filter((e) => e.tradingDay >= 1 && e.tradingDay <= horizon);

  /**
   * The exposure bar is per expiry, not chain-wide. Gamma is spread across
   * dozens of strikes and every listed expiry, so even the single largest
   * strike rarely holds 5% of the chain's grand total — that denominator
   * silently drops every marker. A strike's share of its own expiry is what
   * "dominant magnet" actually means.
   */
  const exposureFloor = (expiry: (typeof inHorizon)[number]) =>
    expiry.strikes.reduce((acc, s) => acc + Math.abs(s.gex), 0) *
    config.magnetMinExposureShare;

  /** The one strike per expiry that pulls hardest in the given direction. */
  const dominantPicks = (sign: 1 | -1) =>
    inHorizon.flatMap((expiry) => {
      const floor = exposureFloor(expiry);
      let best: MagnetStrike | null = null;
      for (const s of expiry.strikes) {
        if (Math.sign(s.weight) !== sign) continue;
        if (!inFrame(s) || Math.abs(s.gex) < floor) continue;
        if (!best || Math.abs(s.weight) > Math.abs(best.weight)) best = s;
      }
      return best ? [{ day: expiry.tradingDay, label: expiry.label, strike: best }] : [];
    });

  const toMarker = (picks: ReturnType<typeof dominantPicks>) =>
    picks.map(({ day, label, strike }) => ({
      day,
      label,
      strike: strike.strike,
      weight: strike.weight,
      gex: strike.gex,
      attract: strike.weight > 0,
    }));

  const markers = [...toMarker(dominantPicks(1)), ...toMarker(dominantPicks(-1))];

  // Every significant strike, shown only behind the toggle.
  const allDots = magnets.flatMap((expiry) =>
    expiry.strikes
      .filter((s) => Math.abs(s.weight) >= 0.25 && inFrame(s))
      .filter(() => expiry.tradingDay >= 1 && expiry.tradingDay <= horizon)
      .map((s) => ({
        cx: forwardX(expiry.tradingDay),
        cy: y(s.strike),
        r: 2 + Math.abs(s.weight) * 3.5,
        attract: s.weight > 0,
        strike: s.strike,
        gex: s.gex,
        label: expiry.label,
      })),
  );

  return (
    <figure className="gd-forecast panel p-0">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-term-line px-3.5 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
          {data.symbol} — 90 sessions, then {horizon} days simulated
        </h2>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-2xs text-term-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ background: COLOR.history }} />
            actual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: COLOR.median }} />
            median
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4" style={{ background: 'rgba(61,220,132,0.34)' }} />
            68%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4" style={{ background: 'rgba(61,220,132,0.14)' }} />
            95%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: COLOR.attractor }} />
            attractor
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: COLOR.repeller }} />
            repeller
          </span>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-term-dim"
            title="Show every significant strike instead of the strongest magnet per expiry."
          >
            <input type="checkbox" className="gd-show-all h-3 w-3 shrink-0 accent-[#f0a500]" />
            show all strikes
          </label>
        </div>
      </figcaption>

      <div className="scroll-term overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          className="block min-w-[680px]"
          role="img"
          aria-label={`${data.symbol} price history and ${horizon}-day simulated forecast cone. Median ends near ${formatPrice(bands[bands.length - 1]?.p50 ?? spot)}.`}
        >
          {/* horizontal grid + price labels on the right */}
          {yTicks.map((price) => (
            <g key={price}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={y(price)}
                y2={y(price)}
                stroke={COLOR.grid}
                strokeWidth={1}
              />
              <text
                x={W - M.right + 6}
                y={y(price) + 3.5}
                fill={COLOR.axis}
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {formatPrice(price)}
              </text>
            </g>
          ))}

          {/* x labels */}
          {xTicks.map((tick) => (
            <text
              key={`${tick.i}-${tick.label}`}
              x={x(tick.i)}
              y={H - 10}
              fill={COLOR.axis}
              fontSize={10}
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
            >
              {tick.label}
            </text>
          ))}

          {/* confidence bands */}
          <path d={bandArea((b) => b.p97_5, (b) => b.p2_5)} fill={COLOR.band95} />
          <path d={bandArea((b) => b.p84, (b) => b.p16)} fill={COLOR.band68} />

          {/* spot reference */}
          <line
            x1={M.left}
            x2={W - M.right}
            y1={y(spot)}
            y2={y(spot)}
            stroke={COLOR.spot}
            strokeWidth={1}
            strokeDasharray="2 4"
            opacity={0.5}
          />

          {/* divider between observed and simulated */}
          <line
            x1={forwardX(0)}
            x2={forwardX(0)}
            y1={M.top}
            y2={M.top + plotH}
            stroke={COLOR.axis}
            strokeWidth={1}
          />
          <text
            x={forwardX(0) + 5}
            y={M.top + 11}
            fill={COLOR.axis}
            fontSize={9}
            fontFamily="ui-monospace, monospace"
          >
            NOW
          </text>

          {/* realised history */}
          <path d={historyPath} fill="none" stroke={COLOR.history} strokeWidth={1.5} />

          {/* median expected path */}
          <path
            d={medianPath}
            fill="none"
            stroke={COLOR.median}
            strokeWidth={1.75}
            strokeDasharray="5 4"
          />

          {/* dominant magnet per expiry — one dot each way, per expiry */}
          <g data-magnets="dominant">
            {/* Two expiries can land on the same trading day, so the index is
                part of the key — strike and day alone are not unique. */}
            {markers.map((s, i) => (
              <circle
                key={`${s.attract ? 'a' : 'r'}-${s.strike}-${s.day}-${i}`}
                cx={forwardX(s.day)}
                cy={y(s.strike)}
                r={2 + Math.abs(s.weight) * 3.5}
                fill={s.attract ? COLOR.attractor : COLOR.repeller}
                fillOpacity={0.85}
                stroke="#0a0e17"
                strokeWidth={0.75}
              >
                <title>
                  {`${s.label} ${formatPrice(s.strike)} — ${s.attract ? 'attractor' : 'repeller'} (GEX ${formatUsd(s.gex)})`}
                </title>
              </circle>
            ))}
          </g>

          {/* the raw field, revealed by the "show all strikes" checkbox */}
          <g data-magnets="all">
            {allDots.map((d, i) => (
              <circle
                key={`${d.strike}-${d.cx}-${i}`}
                cx={d.cx}
                cy={d.cy}
                r={d.r}
                fill={d.attract ? COLOR.attractor : COLOR.repeller}
                fillOpacity={0.85}
                stroke="#0a0e17"
                strokeWidth={0.75}
              >
                <title>
                  {`${d.label} ${formatPrice(d.strike)} — ${d.attract ? 'attractor' : 'repeller'} (GEX ${formatUsd(d.gex)})`}
                </title>
              </circle>
            ))}
          </g>
        </svg>
      </div>
    </figure>
  );
}
