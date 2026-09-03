'use client';

import { useMemo, useState } from 'react';
import { MethodologyDrawer } from './MethodologyDrawer';
import { formatStrike, formatUsd } from '@/lib/format';
import { nearestStrongWall } from '@/lib/simple/walls';
import type { Methodology } from '@/lib/methodology';
import type { PositioningData } from '@/lib/types';

/**
 * The strike ladder as a picture.
 *
 * ## Why this exists next to the exposure table
 *
 * The table already carries every number this chart draws, and for a reader
 * who knows what they are looking for it is the better tool: exact values, and
 * every expiration split out. But the question this page answers first —
 * "where does price sit relative to the levels" — is a spatial one, and
 * answering it from a column of numbers means holding thirty figures in your
 * head at once. Bars answer it in a glance, which is the whole reason for the
 * duplication.
 *
 * ## What it must not become
 *
 * A picture invites reading more into it than the numbers support, so three
 * rules hold here. Every level is *labelled*, never colour-coded alone — a
 * reader who cannot tell the two colours apart still gets the flip line by
 * name. The per-strike sentence describes what the hedging does, never what
 * anyone should do about it. And the window control changes only which bars
 * are drawn: the flip level, the walls and the totals are computed over the
 * whole snapshot and do not move when the view narrows.
 */

/** Strike counts each side of spot offered by the window control. */
const WINDOWS = [5, 10, 20] as const;
type StrikeWindow = (typeof WINDOWS)[number] | 'all';

// --- chart geometry, in viewBox units ---------------------------------------
const VB_WIDTH = 720;
const PAD_TOP = 26;
const PAD_BOTTOM = 16;
const ROW_H = 20;
const BAR_H = 12;
/** Left gutter: strike labels. */
const PLOT_LEFT = 74;
/** Right gutter: the labels for price, the flip, and the two walls. */
const PLOT_RIGHT = 546;
const CENTRE = (PLOT_LEFT + PLOT_RIGHT) / 2;
const HALF_WIDTH = CENTRE - PLOT_LEFT;

interface Row {
  strike: number;
  gex: number;
}

/**
 * One line on what the hedging at a strike does.
 *
 * Deliberately phrased about the dealer's mechanical response, not about what
 * price will do: "tends to slow moves" is what the model claims; "will hold"
 * is not, and neither is anything an order could be placed on.
 */
function readOf(
  row: Row,
  spot: number,
  maxAbs: number,
  wall: 'call' | 'put' | null,
): string {
  const share = maxAbs > 0 ? Math.abs(row.gex) / maxAbs : 0;
  const side = row.strike > spot ? 'above' : 'below';

  if (share < 0.08) {
    return 'Very little dealer gamma sits here, so hedging at this strike does little to how price moves through it.';
  }

  const size = share >= 0.6 ? 'A lot of' : 'Some';

  if (row.gex >= 0) {
    const wallNote =
      wall === 'call'
        ? ' It is the call wall — the nearest heavy strike above price.'
        : wall === 'put'
          ? ' It is the put wall — the nearest heavy strike below price.'
          : '';
    return `${size} positive dealer gamma ${side} price. Hedging it means selling into strength and buying into weakness, which tends to slow moves around this strike.${wallNote}`;
  }

  return `${size} negative dealer gamma ${side} price. Hedging it means buying into strength and selling into weakness, which tends to speed moves up around this strike.`;
}

export function GammaProfile({
  data,
  methodology,
}: {
  data: PositioningData;
  methodology: Methodology;
}) {
  const [strikeWindow, setStrikeWindow] = useState<StrikeWindow>(10);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);

  const spot = data.summary.spot;
  const flip = data.summary.flipLevel;

  /*
   * Walls come from the whole snapshot and from the shared helper, never from
   * the visible window. Narrowing the view must not be able to rename a level,
   * and this is the same call /decision and the verdict above make.
   */
  const { all, callWall, putWall } = useMemo(() => {
    const rows: Row[] = data.rows.map((r) => ({ strike: r.strike, gex: r.total.gex }));
    return {
      all: rows,
      callWall: nearestStrongWall(rows, spot, 'above')?.strike ?? null,
      putWall: nearestStrongWall(rows, spot, 'below')?.strike ?? null,
    };
  }, [data.rows, spot]);

  // Rows arrive highest strike first, so the slice each side of spot takes the
  // *last* of those above and the *first* of those below.
  const rows = useMemo(() => {
    if (strikeWindow === 'all') return all;
    const above = all.filter((r) => r.strike > spot).slice(-strikeWindow);
    const below = all.filter((r) => r.strike <= spot).slice(0, strikeWindow);
    return [...above, ...below];
  }, [all, spot, strikeWindow]);

  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.gex)), 0);

  if (rows.length === 0 || maxAbs === 0) return null;

  const height = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM;
  const yOf = (i: number) => PAD_TOP + i * ROW_H + ROW_H / 2;

  /**
   * Where a price sits between the drawn strikes, or null when it falls
   * outside the visible window — in which case nothing is drawn and the
   * caption names the level instead. Clamping it to an edge would put a
   * labelled line at a strike the level is not at.
   */
  const yOfPrice = (price: number): number | null => {
    const top = rows[0].strike;
    const bottom = rows[rows.length - 1].strike;
    if (price > top || price < bottom) return null;
    for (let i = 0; i < rows.length - 1; i += 1) {
      const hi = rows[i].strike;
      const lo = rows[i + 1].strike;
      if (price <= hi && price >= lo) {
        const t = hi === lo ? 0 : (hi - price) / (hi - lo);
        return yOf(i) + t * ROW_H;
      }
    }
    return yOf(0);
  };

  const active = hovered ?? pinned;
  const activeRow = active === null ? null : (rows[active] ?? null);

  const wallAt = (strike: number): 'call' | 'put' | null =>
    strike === callWall ? 'call' : strike === putWall ? 'put' : null;

  const marker = (
    price: number | null,
    label: string,
    dash: string,
    className: string,
  ) => {
    if (price === null) return null;
    const y = yOfPrice(price);
    if (y === null) return null;
    return (
      <g className={className}>
        <line
          x1={PLOT_LEFT - 12}
          x2={PLOT_RIGHT + 4}
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeWidth={1.25}
          strokeDasharray={dash || undefined}
        />
        <text x={PLOT_RIGHT + 10} y={y + 3.5} fontSize={10} fill="currentColor">
          {label}
        </text>
      </g>
    );
  };

  const offWindow = [
    flip !== null && yOfPrice(flip) === null
      ? `the gamma flip (${formatStrike(flip)})`
      : null,
    callWall !== null && yOfPrice(callWall) === null
      ? `the call wall (${formatStrike(callWall)})`
      : null,
    putWall !== null && yOfPrice(putWall) === null
      ? `the put wall (${formatStrike(putWall)})`
      : null,
  ].filter((s): s is string => s !== null);

  return (
    <section className="space-y-2.5" aria-labelledby="gamma-profile-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="gamma-profile-heading" className="text-sm font-bold text-term-text">
            Dealer gamma, strike by strike
          </h3>
          <p className="mt-0.5 max-w-[62ch] text-2xs leading-relaxed text-term-dim">
            One bar per strike. Bars to the right are positive gamma, where dealer hedging
            tends to slow moves; bars to the left are negative, where it tends to speed them
            up.
          </p>
        </div>

        <div className="flex items-center gap-1.5" role="group" aria-label="Strike window">
          <span className="label-xs">Strikes each side</span>
          {[...WINDOWS, 'all' as const].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => {
                setStrikeWindow(w);
                // The pinned index refers to a row list that is about to
                // change length, so it would point at a different strike.
                setPinned(null);
                setHovered(null);
              }}
              aria-pressed={strikeWindow === w}
              className={`border px-2.5 py-1 text-2xs tabular-nums transition-colors ${
                strikeWindow === w
                  ? 'border-pos/60 bg-pos/12 text-pos'
                  : 'border-term-line bg-term-panel/60 text-term-dim hover:border-term-edge hover:text-term-text'
              }`}
            >
              {w === 'all' ? 'All' : w}
            </button>
          ))}
        </div>
      </div>

      <div className="panel px-2 py-2">
        <svg
          viewBox={`0 0 ${VB_WIDTH} ${height}`}
          className="h-auto w-full font-mono"
          role="img"
          aria-label={`Net dealer gamma for ${data.symbol} at ${rows.length} strikes around ${spot.toFixed(2)}.`}
          onPointerLeave={() => setHovered(null)}
        >
          {/* The zero line every bar is measured from. */}
          <line
            x1={CENTRE}
            x2={CENTRE}
            y1={PAD_TOP - 8}
            y2={height - PAD_BOTTOM + 2}
            className="text-term-edge"
            stroke="currentColor"
            strokeWidth={1}
          />
          <text
            x={CENTRE - 6}
            y={PAD_TOP - 12}
            fontSize={9}
            textAnchor="end"
            className="text-term-faint"
            fill="currentColor"
          >
            &larr; negative
          </text>
          <text
            x={CENTRE + 6}
            y={PAD_TOP - 12}
            fontSize={9}
            className="text-term-faint"
            fill="currentColor"
          >
            positive &rarr;
          </text>

          {rows.map((row, i) => {
            const y = yOf(i);
            const width = (Math.abs(row.gex) / maxAbs) * HALF_WIDTH;
            const x = row.gex >= 0 ? CENTRE : CENTRE - width;
            const isActive = active === i;
            const wall = wallAt(row.strike);

            return (
              <g
                key={row.strike}
                tabIndex={0}
                role="button"
                aria-label={`Strike ${formatStrike(row.strike)}, net gamma ${formatUsd(row.gex)}. ${readOf(row, spot, maxAbs, wall)}`}
                onPointerEnter={() => setHovered(i)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                onClick={() => setPinned((p) => (p === i ? null : i))}
                /*
                  The focus ring is suppressed because focus already paints the
                  whole row and fills the readout below — the default ring on an
                  SVG group draws a heavy box around the bar and its label, and
                  reads as a second, competing highlight.
                */
                className="cursor-pointer outline-none"
              >
                {/* Full-width hit area, so a tap anywhere on the row selects it. */}
                <rect
                  x={0}
                  y={y - ROW_H / 2}
                  width={VB_WIDTH}
                  height={ROW_H}
                  fill={isActive ? 'currentColor' : 'transparent'}
                  className={isActive ? 'text-term-raised' : undefined}
                />
                <text
                  x={PLOT_LEFT - 16}
                  y={y + 3.5}
                  fontSize={10}
                  textAnchor="end"
                  fill="currentColor"
                  className={wall || isActive ? 'text-term-text' : 'text-term-dim'}
                >
                  {formatStrike(row.strike)}
                </text>
                <rect
                  x={x}
                  y={y - BAR_H / 2}
                  width={Math.max(width, 0.75)}
                  height={BAR_H}
                  fill="currentColor"
                  className={row.gex >= 0 ? 'text-pos' : 'text-neg'}
                  opacity={isActive ? 1 : 0.72}
                />
                {wall && (
                  <text
                    x={row.gex >= 0 ? x + width + 6 : x - 6}
                    y={y + 3.5}
                    fontSize={9.5}
                    textAnchor={row.gex >= 0 ? 'start' : 'end'}
                    fill="currentColor"
                    className="text-term-text"
                  >
                    {wall === 'call' ? 'Call wall' : 'Put wall'}
                  </text>
                )}
              </g>
            );
          })}

          {/*
            Drawn after the bars so the labelled lines are never hidden under
            one. Solid for price, dashed for the flip — but both are named in
            text, because the difference between the two must not depend on
            telling a solid line from a dashed one.
          */}
          {marker(spot, `Price now ${spot.toFixed(2)}`, '', 'text-term-text')}
          {flip !== null &&
            marker(flip, `Gamma flip ${formatStrike(flip)}`, '5 3', 'text-flip')}
        </svg>
      </div>

      {/*
        A fixed readout under the chart rather than a floating tooltip: it is
        the same target on a phone as with a mouse, it cannot be clipped by the
        panel edge, and it has room for a whole sentence.
      */}
      <div className="panel min-h-[4.25rem] px-3.5 py-2.5" aria-live="polite">
        {activeRow === null ? (
          <p className="text-2xs leading-relaxed text-term-faint">
            Point at a bar — or tap one — for the strike, its net gamma, and what the hedging
            there does. Tapping the same bar again unpins it.
          </p>
        ) : (
          <>
            <p className="text-xs font-bold tabular-nums text-term-text">
              {formatStrike(activeRow.strike)}
              <span className="ml-2 font-normal text-term-dim">
                net gamma {formatUsd(activeRow.gex)}
              </span>
            </p>
            <p className="mt-1 max-w-[70ch] text-2xs leading-relaxed text-term-dim">
              {readOf(activeRow, spot, maxAbs, wallAt(activeRow.strike))}
            </p>
          </>
        )}
      </div>

      {offWindow.length > 0 && (
        <p className="text-2xs leading-relaxed text-term-faint">
          Outside this window: {offWindow.join(', ')}. Widen the strike range to see
          {offWindow.length > 1 ? ' them.' : ' it.'}
        </p>
      )}

      <MethodologyDrawer methodology={methodology} anchor="levels" />
    </section>
  );
}
