'use client';

/*
 * SCRATCH — gamma-chart design comparison only.
 *
 * Two candidate redesigns of the strike-by-strike gamma chart, rendered at a
 * fixed 10-strikes-each-side / net / bars view so the *look* can be judged on
 * the Vercel preview. Not wired into any real page; delete this folder and
 * `src/app/gamma-lab` once a direction is chosen and folded into GammaProfile.
 */

import { useMemo } from 'react';
import { formatStrike } from '@/lib/format';
import type { GammaProfileData, GammaProfilePoint } from '@/lib/gammaProfile';

const POSITIVE = 'text-pos';
const NEGATIVE = 'text-neg';
const WIDTH = 10; // strikes each side, fixed for the comparison

function windowRows(profile: GammaProfileData): GammaProfilePoint[] {
  const { points, spot } = profile;
  const ascending = [
    ...points.filter((p) => p.strike <= spot).slice(-WIDTH),
    ...points.filter((p) => p.strike > spot).slice(0, WIDTH),
  ];
  return ascending.slice().reverse(); // highest strike first
}

/* ------------------------------------------------------------------ */
/* Variant A — balanced full width                                    */
/* Same diverging layout, but the plot fills the panel and the price/ */
/* flip labels hug the bars instead of floating in dead space.        */
/* ------------------------------------------------------------------ */

const A = {
  VB: 760,
  PAD_TOP: 30,
  PAD_BOTTOM: 16,
  ROW_H: 16,
  BAR_H: 10,
  LEFT: 56,
  RIGHT: 626, // narrow right gutter — just enough for a compact chip
};
const A_CENTRE = (A.LEFT + A.RIGHT) / 2;
const A_HALF = A_CENTRE - A.LEFT;

export function GammaVariantA({ profile }: { profile: GammaProfileData }) {
  const rows = useMemo(() => windowRows(profile), [profile]);
  const { spot, flipLevel } = profile;
  const maxAbs = rows.reduce((m, p) => Math.max(m, Math.abs(p.netGex)), 0) || 1;
  const height = A.PAD_TOP + rows.length * A.ROW_H + A.PAD_BOTTOM;
  const yOf = (i: number) => A.PAD_TOP + i * A.ROW_H + A.ROW_H / 2;

  const yOfPrice = (price: number): number | null => {
    if (rows.length === 0) return null;
    const top = rows[0].strike;
    const bottom = rows[rows.length - 1].strike;
    if (price > top || price < bottom) return null;
    for (let i = 0; i < rows.length - 1; i += 1) {
      const hi = rows[i].strike;
      const lo = rows[i + 1].strike;
      if (price <= hi && price >= lo) {
        const t = hi === lo ? 0 : (hi - price) / (hi - lo);
        return yOf(i) + t * A.ROW_H;
      }
    }
    return yOf(0);
  };

  const marker = (
    price: number | null,
    label: string,
    dash: string | undefined,
    cls: string,
  ) => {
    if (price === null) return null;
    const y = yOfPrice(price);
    if (y === null) return null;
    return (
      <g className={cls}>
        <line
          x1={A.LEFT - 12}
          x2={A.RIGHT}
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeDasharray={dash}
          opacity={0.9}
        />
        <text
          x={A.RIGHT + 6}
          y={y + 3.3}
          fontSize={10}
          fill="currentColor"
        >
          {label}
        </text>
      </g>
    );
  };

  return (
    <div className="panel px-2 py-2">
      <svg viewBox={`0 0 ${A.VB} ${height}`} className="h-auto w-full font-mono" role="img">
        <line
          x1={A_CENTRE}
          x2={A_CENTRE}
          y1={A.PAD_TOP - 10}
          y2={height - A.PAD_BOTTOM + 2}
          className="text-term-edge"
          stroke="currentColor"
          strokeWidth={1}
        />
        <text x={A_CENTRE - 6} y={A.PAD_TOP - 14} fontSize={9} textAnchor="end" className={NEGATIVE} fill="currentColor">
          &larr; negative gamma
        </text>
        <text x={A_CENTRE + 6} y={A.PAD_TOP - 14} fontSize={9} className={POSITIVE} fill="currentColor">
          positive gamma &rarr;
        </text>

        {rows.map((point, i) => {
          const y = yOf(i);
          const v = point.netGex;
          const barW = (Math.abs(v) / maxAbs) * A_HALF;
          const x = v >= 0 ? A_CENTRE : A_CENTRE - barW;
          const isMagnet = point.strike === profile.magnetAbove || point.strike === profile.magnetBelow;
          return (
            <g key={point.strike}>
              <text
                x={A.LEFT - 16}
                y={y + 3.3}
                fontSize={10}
                textAnchor="end"
                fill="currentColor"
                className={isMagnet ? 'text-term-text' : 'text-term-dim'}
              >
                {formatStrike(point.strike)}
              </text>
              <rect
                x={x}
                y={y - A.BAR_H / 2}
                width={Math.max(barW, 0.75)}
                height={A.BAR_H}
                rx={1.5}
                fill="currentColor"
                className={v >= 0 ? POSITIVE : NEGATIVE}
                opacity={0.78}
              />
              {isMagnet && (
                <text x={A.LEFT - 44} y={y + 3.3} fontSize={8.5} className="text-term-faint" fill="currentColor">
                  {point.strike === profile.magnetAbove ? '↑' : '↓'}
                </text>
              )}
            </g>
          );
        })}

        {marker(spot, `price ${spot.toFixed(2)}`, undefined, 'text-term-text')}
        {flipLevel !== null && marker(flipLevel, `flip ${formatStrike(flipLevel)}`, '5 4', 'text-level')}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Variant B — clean rows, no spanning lines                          */
/* Row striping, rounded bars, and price/flip shown as a full-row     */
/* tint + inline pill instead of a line crossing the empty right side.*/
/* ------------------------------------------------------------------ */

const B = {
  VB: 760,
  PAD_TOP: 30,
  PAD_BOTTOM: 14,
  ROW_H: 18,
  BAR_H: 12,
  LEFT: 60,
  RIGHT: 600, // right band holds the price/flip/magnet pills
};
const B_CENTRE = (B.LEFT + B.RIGHT) / 2;
const B_HALF = B_CENTRE - B.LEFT;

export function GammaVariantB({ profile }: { profile: GammaProfileData }) {
  const rows = useMemo(() => windowRows(profile), [profile]);
  const { spot, flipLevel, magnetAbove, magnetBelow } = profile;
  const maxAbs = rows.reduce((m, p) => Math.max(m, Math.abs(p.netGex)), 0) || 1;
  const height = B.PAD_TOP + rows.length * B.ROW_H + B.PAD_BOTTOM;
  const yOf = (i: number) => B.PAD_TOP + i * B.ROW_H + B.ROW_H / 2;

  // Which drawn row is closest to spot / flip, for the row tint + pill.
  const nearest = (price: number | null): number | null => {
    if (price === null) return null;
    let best: number | null = null;
    let gap = Infinity;
    rows.forEach((p, i) => {
      const d = Math.abs(p.strike - price);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    return best;
  };
  const spotRow = nearest(spot);
  const flipRow = nearest(flipLevel);

  const pill = (x: number, y: number, text: string, cls: string) => (
    <text x={x} y={y + 3.3} fontSize={9.5} fill="currentColor" className={cls}>
      {text}
    </text>
  );

  return (
    <div className="panel px-2 py-2">
      <svg viewBox={`0 0 ${B.VB} ${height}`} className="h-auto w-full font-mono" role="img">
        <text x={B_CENTRE - 6} y={B.PAD_TOP - 14} fontSize={9} textAnchor="end" className={NEGATIVE} fill="currentColor">
          &larr; negative gamma
        </text>
        <text x={B_CENTRE + 6} y={B.PAD_TOP - 14} fontSize={9} className={POSITIVE} fill="currentColor">
          positive gamma &rarr;
        </text>

        {rows.map((point, i) => {
          const y = yOf(i);
          const v = point.netGex;
          const barW = (Math.abs(v) / maxAbs) * B_HALF;
          const x = v >= 0 ? B_CENTRE : B_CENTRE - barW;
          const isSpot = i === spotRow;
          const isFlip = i === flipRow && !isSpot;
          const isMagnetUp = point.strike === magnetAbove;
          const isMagnetDown = point.strike === magnetBelow;
          const rowTint = isSpot
            ? 'text-term-text'
            : isFlip
              ? 'text-level'
              : i % 2 === 0
                ? 'text-term-raised'
                : 'text-transparent';
          return (
            <g key={point.strike}>
              {/* Full-row band: striping for ordinary rows, a stronger tint for
                  spot/flip so they read without a line crossing the panel. */}
              <rect
                x={0}
                y={y - B.ROW_H / 2}
                width={B.VB}
                height={B.ROW_H}
                fill="currentColor"
                className={rowTint}
                opacity={isSpot ? 0.1 : isFlip ? 0.1 : 0.4}
              />
              <text
                x={B.LEFT - 16}
                y={y + 3.3}
                fontSize={10}
                textAnchor="end"
                fill="currentColor"
                className={isSpot || isFlip || isMagnetUp || isMagnetDown ? 'text-term-text' : 'text-term-dim'}
              >
                {formatStrike(point.strike)}
              </text>
              <rect
                x={x}
                y={y - B.BAR_H / 2}
                width={Math.max(barW, 1)}
                height={B.BAR_H}
                rx={2}
                fill="currentColor"
                className={v >= 0 ? POSITIVE : NEGATIVE}
                opacity={0.85}
              />
              {/* Inline pills in the right band — no spanning lines. */}
              {isSpot && pill(B.RIGHT + 8, y, `● price ${spot.toFixed(2)}`, 'text-term-text')}
              {isFlip && flipLevel !== null && pill(B.RIGHT + 8, y, `◇ flip ${formatStrike(flipLevel)}`, 'text-level')}
              {!isSpot && !isFlip && isMagnetUp && pill(B.RIGHT + 8, y, '◆ magnet ↑', 'text-term-faint')}
              {!isSpot && !isFlip && isMagnetDown && pill(B.RIGHT + 8, y, '◆ magnet ↓', 'text-term-faint')}
            </g>
          );
        })}

        <line
          x1={B_CENTRE}
          x2={B_CENTRE}
          y1={B.PAD_TOP - 8}
          y2={height - B.PAD_BOTTOM + 2}
          className="text-term-edge"
          stroke="currentColor"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
