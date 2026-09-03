'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatContracts, formatStrike, formatUsd } from '@/lib/format';
import type { GammaProfileData, GammaProfilePoint } from '@/lib/gammaProfile';

/**
 * The strike ladder as a picture.
 *
 * ## Why it exists next to the exposure table
 *
 * The table carries every number this draws, and for a reader who knows what
 * they are looking for it is the better tool. But the first question this page
 * answers — where price sits relative to the flip and the magnets — is a
 * spatial one, and answering it out of a column of fifty figures is work.
 *
 * ## Rules this component holds to
 *
 * Nothing is computed here that the server already decided. The flip level and
 * both magnets arrive as prices (see `lib/gammaProfile.ts`); the browser only
 * places them. A chart that re-derived its own flip would eventually draw a
 * line at a price the sentence above it does not name.
 *
 * Every level is *labelled*, never colour alone. And the per-strike wording
 * describes what dealer hedging does, never what anyone should do about it.
 *
 * ## Colour
 *
 * Blue is positive gamma, amber is negative, violet is the flip line. Red and
 * green are deliberately absent: a beginner reads them as sell and buy, and
 * the two gamma states are calm versus jumpy — not bad versus good. Note this
 * is the reverse of the exposure table's shading, which is amber-positive; see
 * the decision log in the PR.
 */

const POSITIVE = 'text-neg'; // blue token (`--c-cool`)
const NEGATIVE = 'text-pos'; // amber token (`--c-brand`)

/** Strikes each side of spot. `25` is the default — a ~50 strike window. */
const WIDTHS = [10, 25, 50] as const;
const DEFAULT_WIDTH: Width = 25;
type Width = (typeof WIDTHS)[number] | 'all';

type View = 'bars' | 'cumulative';
type Series = 'net' | 'calls' | 'puts';

const SERIES_LABEL: Record<Series, string> = {
  net: 'Net',
  calls: 'Calls',
  puts: 'Puts',
};

const VIEW_LABEL: Record<View, string> = {
  bars: 'Bars',
  cumulative: 'Running total',
};

function valueOf(point: GammaProfilePoint, series: Series): number {
  if (series === 'calls') return point.callGex;
  if (series === 'puts') return point.putGex;
  return point.netGex;
}

// --- chart geometry, in viewBox units ---------------------------------------
const VB_WIDTH = 760;
const PAD_TOP = 28;
const PAD_BOTTOM = 18;
const ROW_H = 18;
const BAR_H = 11;
/** Left gutter: strike labels. */
const PLOT_LEFT = 78;
/** Right gutter: the labels for price, the flip, and the two magnets. */
const PLOT_RIGHT = 556;
const CENTRE = (PLOT_LEFT + PLOT_RIGHT) / 2;
const HALF_WIDTH = CENTRE - PLOT_LEFT;

export function GammaProfile({ profile }: { profile: GammaProfileData }) {
  const [view, setView] = useState<View>('bars');
  const [series, setSeries] = useState<Series>('net');
  const [width, setWidth] = useState<Width>(DEFAULT_WIDTH);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);

  const { spot, flipLevel, magnetAbove, magnetBelow, points } = profile;

  /*
   * The window is a display choice and nothing else. Every level on the chart
   * was computed over the whole snapshot, so narrowing the view can hide a
   * line but can never move one.
   *
   * Drawn highest strike at the top, the conventional orientation for a strike
   * ladder — the source array is ascending.
   */
  const rows = useMemo(() => {
    const ascending =
      width === 'all'
        ? points
        : [
            ...points.filter((p) => p.strike <= spot).slice(-width),
            ...points.filter((p) => p.strike > spot).slice(0, width),
          ];
    return ascending.slice().reverse();
  }, [points, spot, width]);

  /*
   * The running total, summed from the lowest strike upward, in the same order
   * as `rows` so index `i` means the same strike in both.
   */
  const cumulative = useMemo(() => {
    const ascending = rows.slice().reverse();
    // `reduce` rather than a running local: the lint rules here reject a
    // variable reassigned inside a render, and the accumulator says the same
    // thing.
    return ascending
      .reduce<number[]>(
        (sums, p) => [...sums, (sums[sums.length - 1] ?? 0) + valueOf(p, series)],
        [],
      )
      .reverse();
  }, [rows, series]);

  const maxAbs =
    view === 'cumulative'
      ? cumulative.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
      : rows.reduce((m, p) => Math.max(m, Math.abs(valueOf(p, series))), 0);

  const height = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM;
  const yOf = (i: number) => PAD_TOP + i * ROW_H + ROW_H / 2;
  const xOf = (value: number) =>
    CENTRE + (maxAbs === 0 ? 0 : (value / maxAbs) * HALF_WIDTH);

  /**
   * Where a price sits between the drawn strikes, or null when it falls
   * outside the window — in which case the line is not drawn and the caption
   * names the level instead. Clamping it to an edge would put a labelled line
   * at a strike the level is not at.
   */
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
        return yOf(i) + t * ROW_H;
      }
    }
    return yOf(0);
  };

  const active = hovered ?? pinned;
  const activeRow = active === null ? null : (rows[active] ?? null);
  const isDefaultView = width === DEFAULT_WIDTH && pinned === null;

  const resetToSpot = () => {
    setWidth(DEFAULT_WIDTH);
    setPinned(null);
    setHovered(null);
  };

  const magnetLabel = (strike: number): string | null => {
    if (strike === magnetAbove) return 'Magnet above — heaviest strike near price, on the way up';
    if (strike === magnetBelow) return 'Magnet below — heaviest strike near price, on the way down';
    return null;
  };

  const marker = (
    price: number | null,
    label: string,
    dash: string | undefined,
    className: string,
  ) => {
    if (price === null) return null;
    const y = yOfPrice(price);
    if (y === null) return null;
    return (
      <g className={className}>
        <line
          x1={PLOT_LEFT - 14}
          x2={PLOT_RIGHT + 4}
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeDasharray={dash}
        />
        <text x={PLOT_RIGHT + 10} y={y + 3.5} fontSize={10} fill="currentColor">
          {label}
        </text>
      </g>
    );
  };

  /** Where the running total changes sign, interpolated between two strikes. */
  const crossing = useMemo(() => {
    if (view !== 'cumulative') return null;
    for (let i = 0; i < cumulative.length - 1; i += 1) {
      const a = cumulative[i];
      const b = cumulative[i + 1];
      if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
        const t = a === b ? 0 : a / (a - b);
        return {
          y: yOf(i) + t * ROW_H,
          strike: rows[i].strike + t * (rows[i + 1].strike - rows[i].strike),
        };
      }
    }
    return null;
  }, [cumulative, rows, view]);

  const offWindow = [
    flipLevel !== null && yOfPrice(flipLevel) === null
      ? `the gamma flip (${formatStrike(flipLevel)})`
      : null,
    magnetAbove !== null && yOfPrice(magnetAbove) === null
      ? `the magnet above (${formatStrike(magnetAbove)})`
      : null,
    magnetBelow !== null && yOfPrice(magnetBelow) === null
      ? `the magnet below (${formatStrike(magnetBelow)})`
      : null,
  ].filter((s): s is string => s !== null);

  if (rows.length === 0) return null;

  const toggle = (selected: boolean) =>
    `border px-2.5 py-1 text-2xs uppercase tracking-[0.1em] transition-colors ${
      selected
        ? 'border-pos/60 bg-pos/12 text-pos'
        : 'border-term-line bg-term-panel/60 text-term-dim hover:border-term-edge hover:text-term-text'
    }`;

  return (
    <section className="space-y-3" aria-labelledby="gamma-profile-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="gamma-profile-heading" className="text-sm font-bold text-term-text">
            {profile.symbol} dealer gamma, strike by strike
          </h3>
          <p className="mt-0.5 max-w-[68ch] text-2xs leading-relaxed text-term-dim">
            One row per strike, highest at the top, centred on the current price.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="Chart view">
            {(['bars', 'cumulative'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={toggle(view === v)}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5" role="group" aria-label="Contract side">
            {(['net', 'calls', 'puts'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeries(s)}
                aria-pressed={series === s}
                className={toggle(series === s)}
              >
                {SERIES_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-xs">Strikes each side</span>
        {[...WIDTHS, 'all' as const].map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => {
              setWidth(w);
              // The pinned index points into a list that is about to change
              // length, so keeping it would select a different strike.
              setPinned(null);
              setHovered(null);
            }}
            aria-pressed={width === w}
            className={`${toggle(width === w)} tabular-nums`}
          >
            {w === 'all' ? 'All' : w}
          </button>
        ))}
        <button
          type="button"
          onClick={resetToSpot}
          disabled={isDefaultView}
          className="border border-term-line bg-term-panel/60 px-2.5 py-1 text-2xs uppercase tracking-[0.1em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text disabled:opacity-40"
        >
          Reset to price
        </button>
      </div>

      <div className="panel px-2 py-2">
        <svg
          viewBox={`0 0 ${VB_WIDTH} ${height}`}
          className="h-auto w-full font-mono"
          role="img"
          aria-label={`${SERIES_LABEL[series]} dealer gamma for ${profile.symbol} at ${rows.length} strikes around ${spot.toFixed(2)}.`}
          onPointerLeave={() => setHovered(null)}
        >
          {/* The zero line every value is measured from. */}
          <line
            x1={CENTRE}
            x2={CENTRE}
            y1={PAD_TOP - 9}
            y2={height - PAD_BOTTOM + 2}
            className="text-term-edge"
            stroke="currentColor"
            strokeWidth={1}
          />
          <text
            x={CENTRE - 6}
            y={PAD_TOP - 13}
            fontSize={9}
            textAnchor="end"
            className={NEGATIVE}
            fill="currentColor"
          >
            &larr; negative gamma
          </text>
          <text
            x={CENTRE + 6}
            y={PAD_TOP - 13}
            fontSize={9}
            className={POSITIVE}
            fill="currentColor"
          >
            positive gamma &rarr;
          </text>

          {rows.map((point, i) => {
            const y = yOf(i);
            const value = valueOf(point, series);
            const barValue = view === 'cumulative' ? cumulative[i] : value;
            const barWidth = maxAbs === 0 ? 0 : (Math.abs(barValue) / maxAbs) * HALF_WIDTH;
            const x = barValue >= 0 ? CENTRE : CENTRE - barWidth;
            const isActive = active === i;
            const magnet = magnetLabel(point.strike);

            return (
              <g
                key={point.strike}
                tabIndex={0}
                role="button"
                aria-label={`Strike ${formatStrike(point.strike)}, ${((point.strike / spot - 1) * 100).toFixed(1)} percent from price. Net gamma ${formatUsd(point.netGex)}, calls ${formatUsd(point.callGex)}, puts ${formatUsd(point.putGex)}.`}
                onPointerEnter={() => setHovered(i)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                onClick={() => setPinned((p) => (p === i ? null : i))}
                /*
                  The focus ring is suppressed because focus already paints the
                  whole row and fills the readout below; the default ring boxes
                  the bar and its label as a second, competing highlight.
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
                  x={PLOT_LEFT - 18}
                  y={y + 3.5}
                  fontSize={10}
                  textAnchor="end"
                  fill="currentColor"
                  className={magnet || isActive ? 'text-term-text' : 'text-term-dim'}
                >
                  {formatStrike(point.strike)}
                </text>

                {view === 'bars' && (
                  <rect
                    x={x}
                    y={y - BAR_H / 2}
                    width={Math.max(barWidth, 0.75)}
                    height={BAR_H}
                    fill="currentColor"
                    className={barValue >= 0 ? POSITIVE : NEGATIVE}
                    opacity={isActive ? 1 : 0.72}
                  />
                )}

                {magnet && (
                  <text
                    x={PLOT_LEFT - 66}
                    y={y + 3.5}
                    fontSize={9}
                    className="text-term-faint"
                    fill="currentColor"
                  >
                    {point.strike === magnetAbove ? 'magnet ↑' : 'magnet ↓'}
                  </text>
                )}
              </g>
            );
          })}

          {view === 'cumulative' && (
            <>
              {/*
                The running total, added up from the lowest strike on screen.
                Drawn as one line so the sign change reads as a crossing of the
                zero axis rather than as a colour change between two bars.
              */}
              <polyline
                points={cumulative.map((v, i) => `${xOf(v)},${yOf(i)}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                /*
                  Neutral, not one of the two gamma colours: the line crosses
                  from one side of the axis to the other, and painting the
                  whole of it blue would colour its negative half positive.
                  Which side it is on is the sign.
                */
                className="text-term-text"

              />
              {crossing && (
                <g className="text-term-text">
                  <circle cx={CENTRE} cy={crossing.y} r={3.5} fill="currentColor" />
                  <text x={CENTRE + 8} y={crossing.y - 7} fontSize={9} fill="currentColor">
                    running total crosses zero near {formatStrike(Math.round(crossing.strike))}
                  </text>
                </g>
              )}
            </>
          )}

          {/*
            Drawn last so a labelled level is never hidden under a bar. Solid
            for price, dashed and violet for the flip — but both are named in
            text, because telling them apart must not depend on telling a solid
            line from a dashed one.
          */}
          {marker(spot, `Price now ${spot.toFixed(2)}`, undefined, 'text-term-text')}
          {flipLevel !== null &&
            marker(flipLevel, `Gamma flip ${formatStrike(flipLevel)}`, '6 4', 'text-level')}
        </svg>
      </div>

      {/*
        A fixed readout under the chart rather than a floating tooltip: the same
        target on a phone as with a mouse, impossible to clip against the panel
        edge, and room for the whole row of numbers.
      */}
      <div className="panel min-h-[5.5rem] px-3.5 py-2.5" aria-live="polite">
        {activeRow === null ? (
          <p className="text-2xs leading-relaxed text-term-faint">
            Point at a row — or tap one — for that strike&rsquo;s call and put gamma, open
            interest, and distance from the current price. Tapping the same row again unpins
            it.
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-bold tabular-nums text-term-text">
              {formatStrike(activeRow.strike)}
              <span className="ml-2 font-normal text-term-dim">
                {activeRow.strike >= spot ? '+' : ''}
                {((activeRow.strike / spot - 1) * 100).toFixed(2)}% from price
              </span>
              {magnetLabel(activeRow.strike) && (
                <span className="ml-2 font-normal text-term-faint">
                  · {magnetLabel(activeRow.strike)}
                </span>
              )}
            </p>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-2xs tabular-nums sm:grid-cols-5">
              {[
                { label: 'Call gamma', value: formatUsd(activeRow.callGex) },
                { label: 'Put gamma', value: formatUsd(activeRow.putGex) },
                { label: 'Net gamma', value: formatUsd(activeRow.netGex) },
                { label: 'Call OI', value: formatContracts(activeRow.oiCall) },
                { label: 'Put OI', value: formatContracts(activeRow.oiPut) },
              ].map((cell) => (
                <div key={cell.label}>
                  <dt className="label-xs">{cell.label}</dt>
                  <dd className="text-term-text">{cell.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {offWindow.length > 0 && (
        <p className="text-2xs leading-relaxed text-term-faint">
          Outside this window: {offWindow.join(', ')}. Widen the strike range to see
          {offWindow.length > 1 ? ' them.' : ' it.'}
        </p>
      )}

      {/* How to read this, in the same callout style as "What am I looking at?". */}
      <div className="panel border-l-2 border-l-pos/50 p-4 text-xs leading-relaxed text-term-dim">
        <h4 className="text-2xs font-bold uppercase tracking-[0.18em] text-pos">
          How to read this
        </h4>
        <ul className="mt-2.5 space-y-2">
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[0.4rem] h-2.5 w-2.5 shrink-0 bg-neg" />
            <span>
              <span className="text-term-text">Blue, to the right: positive gamma.</span>{' '}
              Dealers hedging it sell as price rises and buy as it falls, which tends to slow
              moves around that strike.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[0.4rem] h-2.5 w-2.5 shrink-0 bg-pos" />
            <span>
              <span className="text-term-text">Amber, to the left: negative gamma.</span>{' '}
              Hedging runs the other way — buying as price rises, selling as it falls — which
              tends to speed moves up.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[0.35rem] shrink-0 text-term-faint">
              ›
            </span>
            <span>
              The <span className="text-level">violet dashed line</span> is the gamma flip:
              the price where the whole book crosses from one state to the other. The solid
              line is where price is now.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[0.35rem] shrink-0 text-term-faint">
              ›
            </span>
            <span>
              The <span className="text-term-text">magnets</span> are the nearest strikes
              heavy enough that hedging around them may influence price. Bigger is not better
              or worse — it is just more hedging.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-[0.35rem] shrink-0 text-term-faint">
              ›
            </span>
            <span>
              <span className="text-term-text">Running total</span> adds the strikes up from
              the bottom of the window. Where that line crosses the centre is where the
              strikes on screen cancel out — computed differently from the flip level, so the
              two need not land on the same price.
            </span>
          </li>
        </ul>
      </div>

      {/* Provenance, inline rather than behind a drawer: this chart is new, and
          what it was built from should not need a click. */}
      <div className="panel px-3.5 py-3">
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {profile.facts.map((fact) => (
            <div key={fact.label}>
              <dt className="label-xs">{fact.label}</dt>
              <dd className="mt-0.5 text-2xs leading-relaxed text-term-text">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-term-line pt-3 text-2xs leading-relaxed text-term-dim">
          Dealer positioning is assumed, not observed: the model takes the customer to be a
          buyer of puts and a seller of calls, which puts the dealer long calls and short
          puts. Nothing in an option chain records who was on which side of a trade.
        </p>
        <p className="mt-2 text-2xs text-term-faint">
          <Link href="/guide#levels" className="underline hover:text-term-text">
            Every calculation on the site, in one place
          </Link>
        </p>
      </div>
    </section>
  );
}
