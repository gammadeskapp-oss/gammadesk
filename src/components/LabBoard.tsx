'use client';

import { useMemo, useState } from 'react';
import { loadLabAnalogues } from '@/app/lab/actions';
import { formatUsd } from '@/lib/format';
import {
  FLIP_SPAN_PCT,
  FLOW_RATIO_SPAN,
  MAGNET_SPAN_PCT,
  nearestMagnetPct,
  scoreLabRow,
  type LabScore,
} from '@/lib/lab/score';
import {
  DEFAULT_LAB_WEIGHTS,
  LAB_ANALOGUE_BATCH,
  LAB_EXPLANATION,
  LAB_KEYS,
  LAB_LABEL,
  LAB_LONG_LABEL,
  WEIGHT_BOUNDS,
  type LabAnalogue,
  type LabKey,
  type LabRow,
  type LabView,
  type LabWeights,
} from '@/lib/lab/types';

/**
 * The whole of /lab.
 *
 * ## Ranking, never a shortlist
 *
 * Every name the scan scored is on this list at every setting. The weights
 * reorder it and nothing removes anything, so there is no combination of
 * controls that produces an empty page and no combination that produces a
 * shortlist. That is the difference between this and the scanner, and it is
 * deliberate: the question this page exists to answer is whether a blend
 * surfaces names the individual pages do not, and a blend that filters cannot
 * be compared against anything.
 *
 * ## Everything the reader can move stays in the browser
 *
 * The weights are applied to the snapshot the server already sent. Dragging
 * one re-scores five hundred rows and re-sorts them with no request. The one
 * control that does reach the network is the analogue load, which is a button
 * with a stated cost and a cap rather than a slider.
 *
 * ## Nothing here says what to do
 *
 * A name at the top of this list is the name nothing else scored higher than
 * at weights the reader chose thirty seconds ago. Two of the six components
 * are scored on a direction this page picked rather than one the data implies;
 * both say so wherever they appear and both open at weight zero, so the
 * default ranking does not depend on a guess nobody has tested. There is no
 * verdict column, no position sizing, and no phrasing anywhere that treats a
 * row as an action.
 */

const HEAD_CLASS =
  'whitespace-nowrap border-b border-term-edge bg-term-raised px-2 py-2 text-left text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';

const CELL_CLASS = 'border-b border-term-line/60 px-2 py-1.5 align-top tabular-nums';

/** Columns: rank, ticker, six components, total, detail. */
const COLUMN_COUNT = LAB_KEYS.length + 4;

type SortKey = LabKey | 'total' | 'symbol';

function pct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function score(value: number | null): string {
  return value === null ? '—' : value.toFixed(0);
}

// --- what each component's raw value reads as --------------------------------

/**
 * The raw reading behind a component score, as one short string for the cell.
 *
 * Every column shows this under its score, rather than behind a tooltip. A
 * column of bare 0-100 numbers is a column of this page's own opinions with
 * the measurements taken out, and the measurements are the only part anyone
 * can check.
 */
function rawValue(key: LabKey, row: LabRow): string {
  switch (key) {
    case 'gammaRegime':
      return row.regime === null
        ? '—'
        : `${row.regime === 'positive' ? 'calm' : 'volatile'}${
            row.netGex === null ? '' : ` ${formatUsd(row.netGex)}`
          }`;
    case 'flipDistance':
      return row.flipPct === null ? '—' : pct(row.flipPct);
    case 'magnetDistance': {
      const above = row.magnetAbovePct === null ? '—' : pct(row.magnetAbovePct);
      const below = row.magnetBelowPct === null ? '—' : pct(row.magnetBelowPct);
      if (row.magnetAbovePct === null && row.magnetBelowPct === null) return '—';
      return `${above} / ${below}`;
    }
    case 'rs':
      return row.rsScore === null
        ? '—'
        : `${row.rsScore.toFixed(0)} · #${row.rsRank ?? '?'}`;
    case 'flow':
      if (!row.flow) return '—';
      if (row.flow.topVolumeToOi === null) return 'none flagged';
      return `${row.flow.topVolumeToOi.toFixed(1)}x · ${row.flow.flagged}`;
    case 'analogue': {
      const analogue = row.analogue;
      if (!analogue) return 'not loaded';
      if (analogue.positivePct === null) return '—';
      return `${analogue.positivePct.toFixed(0)}% · n=${analogue.n}`;
    }
  }
}

/** Why a component has no reading. Always populated when the score is null. */
function missingReason(key: LabKey, row: LabRow): string {
  switch (key) {
    case 'gammaRegime':
      return row.gammaNote ?? 'no reading';
    case 'flipDistance':
      return row.flipNote ?? 'no reading';
    case 'magnetDistance':
      return row.magnetNote ?? 'no reading';
    case 'rs':
      return row.rsNote ?? 'no reading';
    case 'flow':
      return row.flowNote ?? 'no reading';
    case 'analogue':
      return (
        row.analogue?.note ??
        'not loaded — the hit rate is fetched on request, and nobody has asked for this name yet'
      );
  }
}

/** The long form, for the expansion: the reading, in a sentence. */
function longValue(key: LabKey, row: LabRow): string {
  switch (key) {
    case 'gammaRegime':
      return row.regime === null
        ? missingReason(key, row)
        : `dealer positioning reads ${row.regime === 'positive' ? 'calm (positive)' : 'volatile (negative)'}${
            row.netGex === null ? '' : `, ${formatUsd(row.netGex)} net`
          }`;
    case 'flipDistance':
      return row.flipPct === null
        ? missingReason(key, row)
        : `the flip level is ${row.flipLevel?.toFixed(2)}, ${Math.abs(row.flipPct).toFixed(1)}% ${
            row.flipPct >= 0 ? 'above' : 'below'
          } the ${row.price?.toFixed(2)} close. Scored on nearness over a ${FLIP_SPAN_PCT}% span`;
    case 'magnetDistance': {
      const nearest = nearestMagnetPct(row);
      if (nearest === null) return missingReason(key, row);
      const parts: string[] = [];
      if (row.magnetAbove && row.magnetAbovePct !== null) {
        parts.push(
          `nearest above is ${row.magnetAbove.strike}, ${row.magnetAbovePct.toFixed(1)}% up`,
        );
      } else {
        parts.push('no stored magnet above the close');
      }
      if (row.magnetBelow && row.magnetBelowPct !== null) {
        parts.push(
          `nearest below is ${row.magnetBelow.strike}, ${Math.abs(row.magnetBelowPct).toFixed(1)}% down`,
        );
      } else {
        parts.push('no stored magnet below the close');
      }
      return `${parts.join('; ')}. Scored on the closer of the two (${nearest.toFixed(1)}%) over a ${MAGNET_SPAN_PCT}% span`;
    }
    case 'rs':
      return row.rsScore === null
        ? missingReason(key, row)
        : `composite ${row.rsScore.toFixed(0)}, ranked #${row.rsRank} of ${row.rsPool} — the score /strength publishes, used unchanged`;
    case 'flow': {
      const flow = row.flow;
      if (!flow) return missingReason(key, row);
      if (flow.topVolumeToOi === null) {
        return `the flow scan covered this chain and flagged nothing on it. That is a reading of zero, not an absent one${
          flow.putCallVolume === null
            ? ''
            : ` (whole-chain put/call volume ${flow.putCallVolume.toFixed(2)})`
        }`;
      }
      return `${flow.flagged} contract${flow.flagged === 1 ? '' : 's'} flagged (${flow.calls} call, ${flow.puts} put); busiest was ${flow.topLabel}. Scored on that ratio over ${FLOW_RATIO_SPAN.low}x to ${FLOW_RATIO_SPAN.high}x, direction-blind`;
    }
    case 'analogue': {
      const analogue = row.analogue;
      if (!analogue || analogue.positivePct === null) return missingReason(key, row);
      const others = analogue.activeLabels.filter(
        (label) => label !== analogue.conditionLabel,
      );
      return `${analogue.conditionLabel} is active today. Of ${analogue.n} past sessions that met it with ${analogue.horizon} sessions elapsed since, ${analogue.positivePct.toFixed(0)}% finished higher${
        analogue.episodes === null
          ? ''
          : `, drawn from ${analogue.episodes} distinct episode${analogue.episodes === 1 ? '' : 's'}`
      }${analogue.thin ? '. Under ten matches — a pattern, not proof' : ''}${
        others.length > 0
          ? `. Also active and not used: ${others.join('; ')} — one condition is picked rather than several averaged, because overlapping samples of the same days do not average into anything`
          : ''
      }`;
    }
  }
}

// --- the weight controls -----------------------------------------------------

function WeightControls({
  weights,
  onChange,
  onReset,
}: {
  weights: LabWeights;
  onChange: (key: LabKey, value: number) => void;
  onReset: () => void;
}) {
  return (
    <section className="panel px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="label-xs">Weights</h2>
        <button
          type="button"
          onClick={onReset}
          className="border border-term-line px-2 py-0.5 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
        >
          Reset to defaults
        </button>
      </div>

      <div className="mt-2 grid gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {LAB_KEYS.map((key) => (
          <label key={key} className="block">
            <span className="flex items-baseline justify-between gap-2">
              <span className="label-xs">{LAB_LONG_LABEL[key]}</span>
              <span
                className={`text-2xs font-bold tabular-nums ${
                  weights[key] > 0 ? 'text-term-text' : 'text-term-faint'
                }`}
              >
                {weights[key].toFixed(2)}
                {weights[key] === 0 && ' — out'}
              </span>
            </span>
            <input
              type="range"
              min={WEIGHT_BOUNDS.min}
              max={WEIGHT_BOUNDS.max}
              step={WEIGHT_BOUNDS.step}
              value={weights[key]}
              aria-label={`${LAB_LONG_LABEL[key]} weight`}
              onChange={(e) => onChange(key, Number(e.target.value))}
              className="mt-1 w-full accent-pos"
            />
            <span className="mt-0.5 block text-2xs leading-relaxed text-term-faint">
              {LAB_EXPLANATION[key]}
            </span>
          </label>
        ))}
      </div>

      <p className="mt-2.5 text-2xs leading-relaxed text-term-faint">
        A weight of zero takes the component out of the blend rather than
        multiplying it by nothing, and the row detail says so. Flip and magnet
        distance start there on purpose: both are scored nearer-is-higher and
        nobody has established that this is the right way round, so they are
        switched on one at a time rather than left running unexamined. Weights
        are not saved — reloading returns to these defaults, which is the state
        any screenshot of this page should be assumed to have been taken in
        unless the panel above says otherwise.
      </p>
    </section>
  );
}

// --- one row -----------------------------------------------------------------

function Row({
  row,
  scored,
  rank,
  weights,
}: {
  row: LabRow;
  scored: LabScore;
  rank: number;
  weights: LabWeights;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr>
        <td className={`${CELL_CLASS} text-term-faint`}>{rank}</td>
        <td className={`${CELL_CLASS} font-bold text-term-text`}>{row.symbol}</td>

        <td className={`${CELL_CLASS} font-bold text-term-text`}>
          {scored.empty ? '—' : scored.total.toFixed(1)}
          <span className="block text-2xs font-normal text-term-faint">
            {scored.measured} of {LAB_KEYS.length}
          </span>
        </td>

        {LAB_KEYS.map((key) => {
          const value = scored.components[key];
          const out = value === null || !(weights[key] > 0);
          return (
            <td
              key={key}
              className={`${CELL_CLASS} ${out ? 'text-term-faint' : 'text-term-dim'}`}
              title={
                value === null
                  ? `${LAB_LONG_LABEL[key]}: ${missingReason(key, row)}`
                  : `${LAB_LONG_LABEL[key]}: score ${value.toFixed(0)}${
                      weights[key] > 0 ? '' : ', weighted to zero and left out'
                    }`
              }
            >
              {score(value)}
              <span className="block text-2xs text-term-faint">
                {rawValue(key, row)}
              </span>
            </td>
          );
        })}

        <td className={`${CELL_CLASS} px-2`}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="border border-term-line px-2 py-0.5 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
          >
            {open ? 'Less' : 'Detail'}
          </button>
        </td>
      </tr>

      {open && (
        <tr>
          <td />
          <td colSpan={COLUMN_COUNT - 1} className="border-b border-term-line px-2 pb-4 pt-1">
            <div className="space-y-2">
              {/*
                The arithmetic, term by term, in the order the blend takes
                them. A total nobody can reconstruct from the row it sits on is
                a number the reader is being asked to trust, and on a page
                built to test whether the total means anything that would be
                the one unusable kind of number.
              */}
              <dl className="space-y-1 text-2xs">
                {LAB_KEYS.map((key) => {
                  const value = scored.components[key];
                  const weight = weights[key];
                  const state =
                    value === null
                      ? 'no reading — left out of the blend, not scored zero'
                      : weight > 0
                        ? `${value.toFixed(1)} × ${weight.toFixed(2)} = ${(value * weight).toFixed(1)}`
                        : `${value.toFixed(1)}, weight 0 — left out`;

                  return (
                    <div key={key} className="flex flex-wrap gap-x-2">
                      <dt className="w-24 shrink-0 font-bold tracking-[0.06em] text-term-faint">
                        {LAB_LABEL[key]}
                      </dt>
                      <dd className="min-w-0 flex-1 leading-relaxed text-term-dim">
                        <span
                          className={
                            value === null || !(weight > 0)
                              ? 'text-term-faint'
                              : 'text-term-text'
                          }
                        >
                          {state}
                        </span>
                        <span className="block text-term-faint">
                          {longValue(key, row)}
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <p className="text-2xs leading-relaxed text-term-faint">
                <span className="label-xs mr-1.5">
                  Total {scored.empty ? 'none' : scored.total.toFixed(2)}
                </span>
                {scored.empty ? (
                  <>
                    Nothing contributed: every component either had no reading or
                    is weighted to zero. The row is at the bottom for want of
                    inputs, which is not the same as scoring badly.
                  </>
                ) : (
                  <>
                    The weighted sum divided by the weights that actually took
                    part ({scored.measured} of {LAB_KEYS.length}).
                    {scored.missing.length > 0 && (
                      <>
                        {' '}
                        {scored.missing.length} had no reading and{' '}
                        {scored.missing.length === 1 ? 'was' : 'were'} left out
                        rather than scored zero — a reading nobody took is not a
                        bad reading.
                      </>
                    )}
                    {scored.zeroed.length > 0 && (
                      <>
                        {' '}
                        {scored.zeroed.length} had a reading and{' '}
                        {scored.zeroed.length === 1 ? 'was' : 'were'} weighted
                        out by you.
                      </>
                    )}{' '}
                    A row blending two components and a row blending six are
                    both on a 0-100 scale and are not measuring the same amount
                    of evidence; the count beside the total is there so the
                    difference stays visible.
                  </>
                )}
              </p>

              <p className="text-2xs text-term-faint">
                Close {row.price === null ? '—' : row.price.toFixed(2)} as of{' '}
                {row.priceAsOf}.
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- the board ---------------------------------------------------------------

const PAGE_SIZES = [50, 100, 250, 503];

export function LabBoard({ view }: { view: LabView }) {
  const [weights, setWeights] = useState<LabWeights>(DEFAULT_LAB_WEIGHTS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'total',
    dir: 'desc',
  });
  const [limit, setLimit] = useState(PAGE_SIZES[0]);

  /** Analogue readings loaded so far, folded onto rows before scoring. */
  const [analogues, setAnalogues] = useState<Record<string, LabAnalogue>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      view.rows.map((row) => ({
        ...row,
        analogue: analogues[row.symbol] ?? null,
      })),
    [view.rows, analogues],
  );

  const scoredRows = useMemo(
    () => rows.map((row) => ({ row, scored: scoreLabRow(row, weights) })),
    [rows, weights],
  );

  const ordered = useMemo(() => {
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...scoredRows].sort((a, b) => {
      if (sort.key === 'symbol') {
        return a.row.symbol.localeCompare(b.row.symbol) * dir;
      }

      const av = sort.key === 'total' ? a.scored.total : a.scored.components[sort.key];
      const bv = sort.key === 'total' ? b.scored.total : b.scored.components[sort.key];

      /*
       * Unmeasured always sorts to the bottom, in both directions. Sorting
       * ascending by a component is how you find the names that scored worst
       * on it, and a screen of names nobody measured is not that answer.
       */
      if (av === null && bv === null) return a.row.symbol.localeCompare(b.row.symbol);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return a.row.symbol.localeCompare(b.row.symbol);
      return (av - bv) * dir;
    });
  }, [scoredRows, sort]);

  const visible = ordered.slice(0, limit);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'symbol' ? 'asc' : 'desc' },
    );
  }

  async function loadAnalogues() {
    const wanted = visible
      .map((entry) => entry.row.symbol)
      .filter((symbol) => !analogues[symbol])
      .slice(0, LAB_ANALOGUE_BATCH);

    if (wanted.length === 0) return;

    setLoading(true);
    setLoadError(null);
    try {
      /*
       * A server action, not a fetch of `/api/lab/analogue`. That endpoint
       * carries the cron auth every manual endpoint here carries, and the only
       * way this button could send the token is if the server had put
       * CRON_SECRET into the page. The action has no URL and no token.
       */
      const results = await loadLabAnalogues(wanted);
      setAnalogues((current) => ({ ...current, ...results }));
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'The analogue request failed.',
      );
    } finally {
      setLoading(false);
    }
  }

  const pending = visible.filter((entry) => !analogues[entry.row.symbol]).length;
  const loaded = Object.keys(analogues).length;

  const sortHead = (key: SortKey, label: string, title: string) => (
    <th scope="col" className={HEAD_CLASS}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        title={title}
        className={`transition-colors hover:text-pos ${
          sort.key === key ? 'text-term-text' : ''
        }`}
      >
        {label}
        {sort.key === key && (sort.dir === 'desc' ? ' ▾' : ' ▴')}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <WeightControls
        weights={weights}
        onChange={(key, value) =>
          setWeights((current) => ({ ...current, [key]: value }))
        }
        onReset={() => setWeights(DEFAULT_LAB_WEIGHTS)}
      />

      <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5 text-2xs">
        <div className="flex items-center gap-1.5">
          <span className="label-xs">Rows</span>
          {PAGE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setLimit(size)}
              className={`border px-1.5 py-0.5 tracking-[0.08em] transition-colors ${
                limit === size
                  ? 'border-pos/50 text-pos'
                  : 'border-term-line text-term-faint hover:text-term-dim'
              }`}
            >
              {size >= view.rows.length ? 'All' : size}
            </button>
          ))}
          <span className="text-term-faint">
            of {view.rows.length} — the list is never narrowed, only cut short
            for rendering.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadAnalogues}
            disabled={loading || pending === 0}
            className="border border-term-line px-2 py-0.5 tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos disabled:opacity-40"
          >
            {loading
              ? 'Loading analogues…'
              : `Load analogues for the next ${Math.min(pending, LAB_ANALOGUE_BATCH)}`}
          </button>
          <span className="text-term-faint">
            {loaded} loaded. Each one reads that name&rsquo;s full price history,
            so it goes {LAB_ANALOGUE_BATCH} at a time, down the list as it is
            currently sorted.
          </span>
        </div>
      </div>

      {loadError && (
        <p className="panel border-l-2 border-l-flip px-3.5 py-2 text-2xs text-flip">
          ! {loadError}
        </p>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead>
            <tr>
              <th scope="col" className={HEAD_CLASS}>
                #
              </th>
              {sortHead('symbol', 'Ticker', 'Sort alphabetically.')}
              {sortHead(
                'total',
                'Total',
                'The weighted blend over the components this name has a reading for. Sorted descending by default.',
              )}
              {LAB_KEYS.map((key) =>
                sortHead(
                  key,
                  LAB_LABEL[key],
                  `${LAB_LONG_LABEL[key]} — ${LAB_EXPLANATION[key]} Click to sort by it; unmeasured names sort to the bottom either way.`,
                ),
              )}
              <th scope="col" className={HEAD_CLASS}>
                <span className="sr-only">Detail</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry, index) => (
              <Row
                key={entry.row.symbol}
                row={entry.row}
                scored={entry.scored}
                rank={index + 1}
                weights={weights}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-2xs leading-relaxed text-term-faint">
        Each cell shows the component score on the first line and the reading it
        was computed from on the second. A dash is an absent reading and never a
        zero — open the row detail for the reason. The rank in the first column
        is a position in this ordering at these weights, and it is not a
        property of the name.
      </p>
    </div>
  );
}
