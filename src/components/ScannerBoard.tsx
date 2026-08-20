'use client';

import { useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { ScannerChart } from '@/components/ScannerChart';
import { TickerLink } from '@/components/TickerLink';
import { formatPrice, formatUsd } from '@/lib/format';
import { partition, type RowOutcome } from '@/lib/scanner/evaluate';
import type { NwSettings } from '@/lib/scanner/nadarayaWatson';
import {
  FILTER_LABEL,
  SCAN_TIMEFRAMES,
  SINGLE_FILTERS,
  STRICTNESS_LABEL,
  STRICTNESS_MODES,
  TIMEFRAME_FILTERS,
  TIMEFRAME_LABEL,
  timeframesForMode,
  type FilterState,
  type NwState,
  type ScanResult,
  type ScanRow,
  type ScanTimeframe,
  type StrictnessMode,
  type TimeframeFilterKey,
  type VwapAnchor,
} from '@/lib/scanner/types';

/**
 * The scanner's rendered output.
 *
 * All the strictness toggle does is re-partition rows the scan already stored,
 * which is why it responds instantly and why the pass list and the near-miss
 * list can never disagree — both come out of one `partition` call over the
 * same numbers.
 */

/** Compact labels for the five single-shot filters. */
const SINGLE_ABBREV: Record<(typeof SINGLE_FILTERS)[number], string> = {
  rs: 'RS',
  volume: 'VOL',
  liquidity: 'LIQ',
  gamma: 'GAM',
  spyGamma: 'SPY',
};

const STATE_CLASS: Record<FilterState, string> = {
  pass: 'border-bull/50 bg-bull/15 text-bull',
  fail: 'border-bear/50 bg-bear/10 text-bear',
  // Grey, and never red. A filter nobody could compute has not failed.
  unknown: 'border-term-line bg-term-raised text-term-faint',
};

/**
 * The NW cell keeps its colours even though it no longer gates anything.
 *
 * Amber says price is sitting inside the envelope — not above it and not
 * clearly below it. That used to be a fail; now it is just a place on a scale,
 * but it is still worth seeing at a glance, because the entry being watched
 * for is a close back *above* the band and the in-band state is the run-up to
 * it. `unavailable` is the 4H case: no band is computed there at all.
 */
const NW_CLASS: Record<NwState, string> = {
  above: 'border-bull/50 bg-bull/15 text-bull',
  inside: 'border-flip/50 bg-flip/10 text-flip',
  below: 'border-bear/50 bg-bear/10 text-bear',
  unknown: 'border-term-line bg-term-raised text-term-faint',
  unavailable: 'border-term-line/50 bg-transparent text-term-faint/60',
};

const NW_WORD: Record<NwState, string> = {
  above: 'above band',
  inside: 'in band',
  below: 'below band',
  unknown: 'not computable',
  unavailable: 'no band on this timeframe',
};

const STATE_GLYPH: Record<FilterState, string> = {
  pass: '✓',
  fail: '✕',
  unknown: '?',
};

function Chip({
  label,
  state,
  title,
}: {
  label: string;
  state: FilterState;
  title: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-0.5 text-2xs font-bold tracking-[0.08em] ${STATE_CLASS[state]}`}
    >
      {label}
      <span aria-hidden>{STATE_GLYPH[state]}</span>
      {/* The glyph is decorative; the state has to reach a screen reader too. */}
      <span className="sr-only">{state}</span>
    </span>
  );
}

/**
 * Rows VWAP / 200 EMA / NW z, columns 1H / 4H / D.
 *
 * The first two rows are gates and carry pass/fail glyphs. The third is not a
 * gate at all — it prints the NW z-score, so it shows a number rather than a
 * tick, and it is never dimmed by the strictness toggle because the toggle has
 * no bearing on it. 4H shows a dash there: no band is computed on that
 * timeframe, which is a different thing from a band that failed.
 */
function TimeframeGrid({
  row,
  mode,
  trendEmaPeriod,
}: {
  row: ScanRow;
  mode: StrictnessMode;
  trendEmaPeriod: number;
}) {
  const consulted = timeframesForMode(mode);

  const reading = (tf: ScanTimeframe) => row.timeframes.find((t) => t.timeframe === tf);

  const rowLabel: Record<TimeframeFilterKey, string> = {
    vwap: 'VWAP',
    ema: `${trendEmaPeriod}E`,
  };

  return (
    <table className="border-separate border-spacing-0.5 text-2xs">
      <caption className="sr-only">
        VWAP and {trendEmaPeriod} EMA state, and the Nadaraya-Watson z-score, for{' '}
        {row.symbol} on each timeframe.
      </caption>
      <thead>
        <tr>
          <td />
          {SCAN_TIMEFRAMES.map((tf) => (
            <th
              key={tf}
              scope="col"
              className={`px-1 font-bold tracking-[0.08em] ${
                consulted.includes(tf) ? 'text-term-dim' : 'text-term-faint/50'
              }`}
            >
              {TIMEFRAME_LABEL[tf]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {TIMEFRAME_FILTERS.map((key) => (
          <tr key={key}>
            <th
              scope="row"
              className="pr-1 text-right font-bold tracking-[0.08em] text-term-faint"
            >
              {rowLabel[key]}
            </th>
            {SCAN_TIMEFRAMES.map((tf) => {
              const r = reading(tf);
              const verdict = r?.verdicts[key];
              const state = verdict?.state ?? 'unknown';

              // The VWAP cell names its anchor, in the accessible description
              // as well as the title, so it is never hover-only.
              const extra = key === 'vwap' && r ? ` — ${r.vwapAnchor}-anchored` : '';

              // Columns the current strictness does not consult are dimmed, so
              // the toggle visibly changes what is being counted rather than
              // silently changing the answer.
              const dimmed = consulted.includes(tf) ? '' : 'opacity-35';

              return (
                <td key={tf} className="px-0.5">
                  <span
                    title={`${TIMEFRAME_LABEL[tf]} ${FILTER_LABEL[key]}: ${verdict?.detail ?? 'no data'}${extra}`}
                    className={`flex h-5 w-9 items-center justify-center border font-bold ${STATE_CLASS[state]} ${dimmed}`}
                  >
                    <span aria-hidden>{STATE_GLYPH[state]}</span>
                    <span className="sr-only">
                      {TIMEFRAME_LABEL[tf]} {FILTER_LABEL[key]}:{' '}
                      {verdict?.detail ?? 'no data'}
                      {extra}
                    </span>
                  </span>
                </td>
              );
            })}
          </tr>
        ))}

        <tr>
          <th
            scope="row"
            className="pr-1 text-right font-bold tracking-[0.08em] text-term-faint"
          >
            NW z
          </th>
          {SCAN_TIMEFRAMES.map((tf) => {
            const r = reading(tf);
            const nw = r?.nw;
            const state = nw?.state ?? 'unknown';

            const short =
              nw && state !== 'unavailable' && nw.barsUsed < nw.barsWanted
                ? ` — band over ${nw.barsUsed} of ${nw.barsWanted} bars`
                : '';

            return (
              <td key={tf} className="px-0.5">
                <span
                  title={`${TIMEFRAME_LABEL[tf]} NW: ${NW_WORD[state]}${
                    nw?.z !== null && nw?.z !== undefined
                      ? `, z ${nw.z.toFixed(2)}`
                      : ''
                  }${short}`}
                  className={`flex h-5 w-9 items-center justify-center border tabular-nums font-bold ${NW_CLASS[state]}`}
                >
                  <span aria-hidden>
                    {nw?.z === null || nw?.z === undefined ? '—' : nw.z.toFixed(2)}
                  </span>
                  <span className="sr-only">
                    {TIMEFRAME_LABEL[tf]} Nadaraya-Watson: {NW_WORD[state]}
                    {nw?.z !== null && nw?.z !== undefined
                      ? `, z ${nw.z.toFixed(2)}`
                      : ''}
                    {short}
                  </span>
                </span>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

const head =
  'whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';
const cell = 'border-b border-term-line/60 px-2.5 py-2 align-top';

function ResultRow({
  row,
  outcome,
  mode,
  nwSettings,
  vwapAnchor,
  trendEmaPeriod,
  missing,
}: {
  row: ScanRow;
  outcome: RowOutcome;
  mode: StrictnessMode;
  nwSettings: NwSettings;
  vwapAnchor: Record<string, VwapAnchor>;
  trendEmaPeriod: number;
  /** Set on near-miss rows: the one filter that let it down. */
  missing?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr>
        <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
          <TickerLink symbol={row.symbol} />
        </th>
        <td className={`${cell} text-right tabular-nums text-term-text`}>
          {row.price === null ? '—' : formatPrice(row.price)}
          <div className="text-2xs text-term-faint">{row.priceAsOf}</div>
        </td>
        <td className={`${cell} text-right tabular-nums font-bold text-term-text`}>
          {row.rsScore.toFixed(0)}
          <div className="text-2xs font-normal text-term-faint">#{row.rsRank}</div>
        </td>
        <td className={`${cell} text-term-dim`}>
          <div className="text-2xs">EQ {row.equityTier ?? '—'}</div>
          <div className="text-2xs">OPT {row.optionsTier ?? '—'}</div>
        </td>
        <td className={`${cell} text-right`}>
          {row.regime === null ? (
            <span className="text-2xs text-term-faint">unread</span>
          ) : (
            <>
              <span
                className={`text-2xs font-bold ${
                  row.regime === 'positive' ? 'text-pos' : 'text-neg'
                }`}
              >
                {row.regime}
              </span>
              {row.netGex !== null && (
                <div className="text-2xs tabular-nums text-term-faint">
                  {formatUsd(row.netGex)}
                </div>
              )}
            </>
          )}
        </td>
        <td className={cell}>
          <div className="flex flex-wrap gap-1">
            {SINGLE_FILTERS.map((key) => (
              <Chip
                key={key}
                label={SINGLE_ABBREV[key]}
                state={outcome.verdicts[key].state}
                title={`${FILTER_LABEL[key]}: ${outcome.verdicts[key].detail}`}
              />
            ))}
          </div>
          {missing && (
            <p className="mt-1.5 text-2xs leading-relaxed text-flip">
              Missing: {missing}
            </p>
          )}
        </td>
        <td className={cell}>
          <TimeframeGrid row={row} mode={mode} trendEmaPeriod={trendEmaPeriod} />
        </td>
        <td className={`${cell} text-right`}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="border border-term-line px-1.5 py-0.5 text-2xs tracking-[0.1em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
          >
            {open ? 'Hide chart' : 'Chart'}
          </button>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={8} className="border-b border-term-line/60 px-2.5 pb-4 pt-1">
            <ScannerChart
              symbol={row.symbol}
              magnets={row.magnets}
              nwSettings={nwSettings}
              vwapAnchor={vwapAnchor}
              trendEmaPeriod={trendEmaPeriod}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ResultTable({
  entries,
  mode,
  nwSettings,
  vwapAnchor,
  trendEmaPeriod,
  caption,
  showMissing = false,
}: {
  entries: Array<{ row: ScanRow; outcome: RowOutcome }>;
  mode: StrictnessMode;
  nwSettings: NwSettings;
  vwapAnchor: Record<string, VwapAnchor>;
  trendEmaPeriod: number;
  caption: string;
  showMissing?: boolean;
}) {
  return (
    <div className="scroll-term overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${head} text-left`}>Ticker</th>
            <th scope="col" className={`${head} text-right`}>Price</th>
            <th scope="col" className={`${head} text-right`}>RS</th>
            <th scope="col" className={`${head} text-left`}>Liquidity</th>
            <th scope="col" className={`${head} text-right`}>Gamma</th>
            <th scope="col" className={`${head} text-left`}>Gates 1&ndash;5</th>
            <th scope="col" className={`${head} text-left`}>Gates 6&ndash;7 &middot; NW z</th>
            <th scope="col" className={head}>
              <span className="sr-only">Chart</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ row, outcome }) => (
            <ResultRow
              key={row.symbol}
              row={row}
              outcome={outcome}
              mode={mode}
              nwSettings={nwSettings}
              vwapAnchor={vwapAnchor}
              trendEmaPeriod={trendEmaPeriod}
              missing={showMissing ? outcome.failingLabel : undefined}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScannerBoard({
  scan,
  nwSettings,
  vwapAnchor,
  trendEmaPeriod,
  gammaTimeEt,
  scannedAtEt,
}: {
  scan: ScanResult;
  nwSettings: NwSettings;
  vwapAnchor: Record<string, VwapAnchor>;
  trendEmaPeriod: number;
  gammaTimeEt: string;
  /**
   * New York clock the scan actually ran at, computed on the server.
   *
   * The heading states this rather than the time the job was *scheduled* for.
   * They are normally the same, and when they are not the reader needs to know
   * — a VWAP reading taken at 10:30 is a different fact from one taken at
   * 09:35, and printing the schedule over it would be a false statement about
   * when these numbers were true.
   */
  scannedAtEt: string;
}) {
  const [mode, setMode] = useState<StrictnessMode>('all');

  const { passed, nearMisses, all, biggestEliminator } = useMemo(
    () => partition(scan.rows, mode),
    [scan.rows, mode],
  );

  const gammaStamp = scan.gammaDate
    ? `gamma as of ${gammaTimeEt} ET on ${scan.gammaDate}`
    : 'no same-day gamma';

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-xs text-term-text">
            <span className="font-bold">
              Scanned at {scannedAtEt} ET · {passed.length} of {scan.universe} passed
            </span>{' '}
            <span className="text-term-dim">
              · {scan.candidates} cleared RS {scan.rsMin} · {gammaStamp}
            </span>
          </p>
          {scannedAtEt !== scan.scheduledEt && (
            <p className="mt-1 text-2xs text-flip">
              Scheduled for {scan.scheduledEt} ET. It ran at {scannedAtEt}, so the
              VWAP readings below were taken then.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="label-xs">Agreement</span>
          <div className="flex items-center gap-1">
            {STRICTNESS_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={m === mode}
                className={`border px-2 py-0.5 text-2xs font-bold tracking-[0.08em] transition-colors ${
                  m === mode
                    ? 'border-pos/70 bg-pos/15 text-pos'
                    : 'border-term-line text-term-faint hover:border-pos/50 hover:text-term-dim'
                }`}
              >
                {STRICTNESS_LABEL[m]}
              </button>
            ))}
          </div>
          <InfoTip
            tip={{
              label: 'Agreement',
              plain:
                'How many of the three timeframes must agree before VWAP, the trend EMA and Nadaraya-Watson count as passed.',
              detail:
                'All three is the strict reading and the default. Relaxing it does not re-scan anything — every filter state for every candidate was stored this morning, and this only changes how they are counted. The dimmed columns in the grid are the ones the current setting ignores.',
            }}
          />
        </div>
      </div>

      {scan.gateReason ? (
        <div className="panel border-l-2 border-l-bear/60 px-4 py-8 text-center text-xs">
          <p className="font-bold text-bear">SPY gamma is negative. The scan is empty.</p>
          <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
            Filter 5 is a single market-wide gate, and it is shut. In a negative
            gamma regime dealers amplify moves rather than damping them, so a
            list of individually strong-looking names is at its most misleading
            exactly here. {scan.candidates} names cleared RS {scan.rsMin} and were
            not carried further.
          </p>
        </div>
      ) : passed.length === 0 ? (
        <div className="panel px-4 py-8 text-center text-xs">
          <p className="font-bold text-term-text">
            No names passed today&rsquo;s filters.
          </p>
          <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
            A zero-result day is a real answer, not a broken page.{' '}
            {biggestEliminator ? (
              <>
                The filter that eliminated the most candidates was{' '}
                <span className="text-flip">
                  {FILTER_LABEL[biggestEliminator.key]}
                </span>
                , which knocked out {biggestEliminator.count} of {scan.candidates}.
              </>
            ) : (
              <>No candidates cleared RS {scan.rsMin} to begin with.</>
            )}{' '}
            The near-miss list below is what tells you whether the rules are too
            tight.
          </p>
        </div>
      ) : (
        <section className="panel">
          <ResultTable
            entries={passed}
            mode={mode}
            nwSettings={nwSettings}
            vwapAnchor={vwapAnchor}
            trendEmaPeriod={trendEmaPeriod}
            caption="Names passing all seven gates, ordered by daily Nadaraya-Watson z-score."
          />
        </section>
      )}

      <details className="panel group" open={passed.length === 0 && nearMisses.length > 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-flip transition-transform group-open:rotate-90">
            ▸
          </span>
          <span className="font-bold uppercase tracking-[0.14em] text-flip">
            Passed all but one
          </span>
          <span className="text-term-faint">
            {nearMisses.length} name{nearMisses.length === 1 ? '' : 's'} — the failing
            filter is named on each
          </span>
        </summary>

        {nearMisses.length === 0 ? (
          <p className="border-t border-term-line px-3.5 py-6 text-center text-2xs text-term-faint">
            Nothing missed by exactly one filter today.
          </p>
        ) : (
          <ResultTable
            entries={nearMisses}
            mode={mode}
            nwSettings={nwSettings}
            vwapAnchor={vwapAnchor}
            trendEmaPeriod={trendEmaPeriod}
            caption="Candidates that failed exactly one filter, with the filter and timeframe named."
            showMissing
          />
        )}
      </details>

      {/*
        Always present, and the reason is the SPY gate. When that is shut the
        pass list is empty by definition and nothing misses by exactly one, so
        without this section a gate-closed morning would render a page with no
        rows on it at all — and every candidate's eight filter states, which
        the scan computed and stored, would be invisible. A zero-result day has
        to show its working.
      */}
      <details className="panel group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-term-faint transition-transform group-open:rotate-90">
            ▸
          </span>
          <span className="font-bold uppercase tracking-[0.14em] text-term-dim">
            Every candidate scanned
          </span>
          <span className="text-term-faint">
            {all.length} name{all.length === 1 ? '' : 's'} above RS {scan.rsMin}, with
            all seven gate states and its NW z-score
          </span>
        </summary>

        {all.length === 0 ? (
          <p className="border-t border-term-line px-3.5 py-6 text-center text-2xs text-term-faint">
            No names cleared RS {scan.rsMin}, so nothing was carried into the rest of
            the pipeline.
          </p>
        ) : (
          <ResultTable
            entries={all}
            mode={mode}
            nwSettings={nwSettings}
            vwapAnchor={vwapAnchor}
            trendEmaPeriod={trendEmaPeriod}
            caption="Every candidate above the relative-strength floor, with all seven gate states and its NW z-score."
            showMissing
          />
        )}
      </details>
    </div>
  );
}
