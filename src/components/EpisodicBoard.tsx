'use client';

import { useMemo, useState } from 'react';
import { EpisodicChart } from '@/components/EpisodicChart';
import { passesDisplay } from '@/lib/episodic/scan';
import type { EpisodicFinding, EpisodicParams, EpisodicView } from '@/lib/episodic/types';
import { formatPrice, formatUsd } from '@/lib/format';

/**
 * The episodic-pivot board: the controls, the ranked table and the pause
 * tracker, all client-side over a stored scan.
 *
 * The scan kept every survivor of a wide capture envelope; the sliders here
 * apply the display thresholds on top, and `passesDisplay` — the same function
 * the funnel below counts with — decides what stays. So the reader can tighten
 * the gap, volume, dollar or base-range bars and watch the list shrink without
 * anything re-running. Loosening past the capture floor is the one thing that
 * needs a fresh scan, and the sliders simply stop there.
 *
 * It is a watchlist builder, not an entry signal. There is no buy/sell wording,
 * no alert and no fixed count — whatever qualifies is shown, dead names
 * included and flagged, and an empty board is a real reading.
 */

type SortMode = 'volume' | 'tightening';

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const signedPct1 = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

/** One slider's shape. `min`/`max` come from the capture/strict bounds. */
interface Control {
  key: keyof EpisodicParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  /** Which direction is stricter, for the hint under the slider. */
  stricter: 'higher' | 'lower';
}

export function EpisodicBoard({ view }: { view: EpisodicView }) {
  const [params, setParams] = useState<EpisodicParams>(view.defaults);
  const [sort, setSort] = useState<SortMode>('volume');
  const [expanded, setExpanded] = useState<string | null>(null);

  const controls: Control[] = useMemo(
    () => [
      {
        key: 'gapMinPct',
        label: 'Min gap',
        min: view.capture.gapMinPct,
        max: view.strict.gapMinPct,
        step: 0.005,
        format: (v) => `${(v * 100).toFixed(1)}%`,
        stricter: 'higher',
      },
      {
        key: 'volumeMult',
        label: 'Volume × 50-day avg',
        min: view.capture.volumeMult,
        max: view.strict.volumeMult,
        step: 0.5,
        format: (v) => `${v.toFixed(1)}×`,
        stricter: 'higher',
      },
      {
        key: 'dollarMin',
        label: 'Min $ volume',
        min: view.capture.dollarMin,
        max: view.strict.dollarMin,
        step: 1_000_000,
        format: (v) => formatUsd(v),
        stricter: 'higher',
      },
      {
        key: 'baseRangeMax',
        label: 'Max base range',
        // Lower is stricter here, so the strict value is the small end.
        min: view.strict.baseRangeMax,
        max: view.capture.baseRangeMax,
        step: 0.01,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        stricter: 'lower',
      },
    ],
    [view.capture, view.strict],
  );

  const visible = useMemo(() => {
    const kept = view.findings.filter((f) => passesDisplay(f, params));
    const byVolume = (a: EpisodicFinding, b: EpisodicFinding) =>
      b.volumeRatio - a.volumeRatio || a.symbol.localeCompare(b.symbol);
    if (sort === 'volume') return [...kept].sort(byVolume);
    // Tightening first: smallest last-5 range, nulls (too young to be tight) last.
    return [...kept].sort((a, b) => {
      const ra = a.pause.last5RangePct;
      const rb = b.pause.last5RangePct;
      if (ra === null && rb === null) return byVolume(a, b);
      if (ra === null) return 1;
      if (rb === null) return -1;
      return ra - rb || byVolume(a, b);
    });
  }, [view.findings, params, sort]);

  const deadCount = visible.filter((f) => !f.pause.heldAboveMid).length;
  const isDefault =
    params.gapMinPct === view.defaults.gapMinPct &&
    params.volumeMult === view.defaults.volumeMult &&
    params.dollarMin === view.defaults.dollarMin &&
    params.baseRangeMax === view.defaults.baseRangeMax;

  return (
    <section className="space-y-4">
      {/* --- controls ------------------------------------------------------- */}
      <div className="panel px-3.5 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="label-xs text-term-text">Thresholds</h3>
          <button
            type="button"
            onClick={() => setParams(view.defaults)}
            disabled={isDefault}
            className="text-2xs text-term-faint underline decoration-dotted hover:text-term-dim disabled:opacity-40 disabled:no-underline"
          >
            reset to defaults
          </button>
        </div>
        <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {controls.map((c) => (
            <label key={c.key} className="block text-2xs">
              <span className="flex items-baseline justify-between">
                <span className="font-bold tracking-[0.04em] text-term-faint">{c.label}</span>
                <span className="tabular-nums text-term-text">{c.format(params[c.key])}</span>
              </span>
              <input
                type="range"
                min={c.min}
                max={c.max}
                step={c.step}
                value={params[c.key]}
                onChange={(e) =>
                  setParams((p) => ({ ...p, [c.key]: Number(e.target.value) }))
                }
                className="mt-1 w-full accent-pos"
              />
              <span className="text-term-line">
                {c.stricter === 'higher' ? 'higher is stricter' : 'lower is stricter'} · captured
                floor {c.stricter === 'higher' ? c.format(c.min) : c.format(c.max)}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-term-faint">
          Sliders re-filter the stored scan in place — they never re-run it. They tighten freely
          and loosen only down to the capture floor the scan kept; a wider net than that needs the
          scan to run again.
        </p>
      </div>

      {/* --- funnel --------------------------------------------------------- */}
      {view.funnel && (
        <details className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <summary className="cursor-pointer label-xs text-term-text">
            What the last run scanned, and where names dropped
          </summary>
          <p className="mt-1.5 text-term-dim">
            The most recent run scanned {view.funnel.scanned} of {view.funnel.universe} names in its
            slice of the universe, at the capture envelope. Each stage below is how many that stage
            removed.
          </p>
          <ul className="mt-1.5 space-y-0.5 tabular-nums">
            {[
              ['Too little price history', view.funnel.droppedShortHistory],
              ['Below the $5 / 500k-volume floor', view.funnel.droppedLiquidity],
              ['No qualifying gap in the last 20 sessions', view.funnel.droppedNoGap],
              ['Gap was not fresh (an earlier gap in the base)', view.funnel.droppedNotFresh],
              ['Base was not quiet enough', view.funnel.droppedBaseNotQuiet],
              ['Survived to a finding', view.funnel.survived],
              ['Fetch failed (upstream, not a verdict)', view.funnel.fetchFailed],
              ['Not reached before the time budget', view.funnel.notReached],
            ].map(([label, n]) => (
              <li key={label as string} className="flex justify-between gap-4">
                <span>{label}</span>
                <span className="text-term-dim">{n as number}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* --- sort + counts -------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(
            [
              ['volume', 'Volume ratio'],
              ['tightening', 'Tightening'],
            ] as Array<[SortMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSort(mode)}
              aria-pressed={mode === sort}
              className={`border px-2 py-0.5 text-2xs font-bold tracking-[0.1em] transition-colors ${
                mode === sort
                  ? 'border-pos/70 bg-pos/15 text-pos'
                  : 'border-term-line text-term-faint hover:border-pos/50 hover:text-term-dim'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-2xs text-term-faint tabular-nums">
          {view.findings.length} captured · {visible.length} at these thresholds
          {deadCount > 0 && <span className="text-neg/80"> · {deadCount} dead</span>}
        </p>
      </div>

      {/* --- table ---------------------------------------------------------- */}
      {visible.length > 0 ? (
        <div className="panel overflow-x-auto p-0">
          <table className="w-full min-w-[900px] border-collapse text-2xs tabular-nums">
            <thead>
              <tr className="border-b border-term-line text-left text-term-faint">
                <th className="px-2 py-1.5 font-bold tracking-[0.04em]">Ticker</th>
                <th className="px-2 py-1.5 font-bold tracking-[0.04em]">Gap date</th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">Gap %</th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">Vol ×</th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">$ vol</th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">Base %</th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">Price</th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]">vs gap close</th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]" title="Trading sessions since the gap">
                  Since
                </th>
                <th className="px-2 py-1.5 text-center font-bold tracking-[0.04em]" title="Every close since the gap held at or above the gap-day midpoint">
                  Held
                </th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]" title="Range of the last 5 sessions; tighter is more constructive">
                  Last-5
                </th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]" title="Last-5-session volume vs the trailing 20-day average; under 1 is drying up">
                  Vol 5/20
                </th>
                <th className="px-2 py-1.5 text-right font-bold tracking-[0.04em]" title="High of the current tight range, as a reference level">
                  Range hi
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => {
                const open = expanded === f.symbol;
                const dead = !f.pause.heldAboveMid;
                return (
                  <FindingRow
                    key={f.symbol}
                    finding={f}
                    open={open}
                    dead={dead}
                    onToggle={() => setExpanded(open ? null : f.symbol)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel px-4 py-8 text-center text-xs">
          <p className="font-bold text-term-text">Nothing qualifies at these thresholds.</p>
          <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
            {view.findings.length === 0
              ? 'The last scan surfaced no episodic pivots. That is a real reading — there is no fixed daily count, and a quiet tape produces an empty board.'
              : 'The captured names all fall outside the current sliders. Loosen them (down to the capture floor) to see more.'}
          </p>
        </div>
      )}
    </section>
  );
}

function FindingRow({
  finding: f,
  open,
  dead,
  onToggle,
}: {
  finding: EpisodicFinding;
  open: boolean;
  dead: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-term-line/60 hover:bg-term-line/20 ${
          dead ? 'text-term-faint' : 'text-term-dim'
        }`}
      >
        <td className="px-2 py-1.5 font-bold text-term-text">
          {f.symbol}
          <span className="ml-1 text-term-line">{open ? '▾' : '▸'}</span>
        </td>
        <td className="px-2 py-1.5">{f.gapDate}</td>
        <td className="px-2 py-1.5 text-right text-pos">{signedPct1(f.gapPct)}</td>
        <td className="px-2 py-1.5 text-right">{f.volumeRatio.toFixed(1)}×</td>
        <td className="px-2 py-1.5 text-right">{formatUsd(f.dollarVolume)}</td>
        <td className="px-2 py-1.5 text-right">{pct1(f.baseRangePct)}</td>
        <td className="px-2 py-1.5 text-right text-term-text">{formatPrice(f.currentPrice)}</td>
        <td className={`px-2 py-1.5 text-right ${f.pctFromGapClose >= 0 ? 'text-pos' : 'text-neg'}`}>
          {signedPct1(f.pctFromGapClose)}
        </td>
        <td className="px-2 py-1.5 text-right">{f.pause.sessionsSinceGap}</td>
        <td className={`px-2 py-1.5 text-center font-bold ${dead ? 'text-neg' : 'text-pos'}`}>
          {dead ? 'dead' : '✓'}
        </td>
        <td className="px-2 py-1.5 text-right">
          {f.pause.last5RangePct === null ? '—' : pct1(f.pause.last5RangePct)}
        </td>
        <td
          className={`px-2 py-1.5 text-right ${
            f.pause.vol5vs20 !== null && f.pause.vol5vs20 < 1 ? 'text-pos' : ''
          }`}
        >
          {f.pause.vol5vs20 === null ? '—' : `${f.pause.vol5vs20.toFixed(2)}×`}
        </td>
        <td className="px-2 py-1.5 text-right">
          {f.pause.tightRangeHigh === null ? '—' : formatPrice(f.pause.tightRangeHigh)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={13} className="border-b border-term-line bg-term-line/10 px-3 py-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xs text-term-faint">
              <span className="font-bold text-term-text">{f.symbol}</span>
              {f.name && <span>{f.name}</span>}
              <span>
                gapped {signedPct1(f.gapPct)} on {f.gapDate}, {f.volumeRatio.toFixed(1)}× its 50-day
                volume
              </span>
              {dead && <span className="text-neg">lost the gap-day midpoint — flagged dead</span>}
            </div>
            <EpisodicChart
              bars={f.bars}
              gapDate={f.gapDate}
              midpoint={f.pause.midpoint}
              tightRangeHigh={f.pause.tightRangeHigh}
            />
          </td>
        </tr>
      )}
    </>
  );
}
