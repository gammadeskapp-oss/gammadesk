'use client';

import { useMemo, useState } from 'react';
import { ScannerChart } from '@/components/ScannerChart';
import { TickerLink } from '@/components/TickerLink';
import { formatUsd } from '@/lib/format';
import { partition, whyItMatched, type RowOutcome } from '@/lib/scanner/evaluate';
import type { NwSettings } from '@/lib/scanner/nadarayaWatson';
import { contractSummary } from '@/lib/scanner/optionQuality';
import {
  FILTER_EXPLANATION,
  FILTER_KEYS,
  FILTER_LABEL,
  OPTION_BADGE_LABEL,
  OPTION_WINDOW,
  type FilterKey,
  type FilterState,
  type OptionQuality,
  type OptionQualityBadge,
  type ScanResult,
  type ScanRow,
} from '@/lib/scanner/types';

/**
 * The scanner's rendered output.
 *
 * ## One list, no controls
 *
 * There is no strictness toggle and no "soften the market filter" option. Both
 * existed to produce results on days that should not have any, and a control
 * that turns a hard gate into a score penalty is a control whose only function
 * is to lower the bar at the moment the bar matters most. Five hard gates, one
 * list, and a zero-result morning renders as a zero-result morning with the
 * reason attached.
 *
 * ## Every result is a card, not a table row
 *
 * The old grid packed nine columns of abbreviations — `RS ✓ VOL ✓ LIQ ✓ GAM ✓
 * SPY ✓` over a 3x3 matrix — into a horizontally scrolling table. It was
 * dense, and it was unreadable to anyone who had not memorised the rules. A
 * card can carry the sentences: why this name matched, what the contract looks
 * like, and what to watch on it.
 */

// --- small pieces ------------------------------------------------------------

const STATE_CLASS: Record<FilterState, string> = {
  pass: 'border-bull/50 bg-bull/15 text-bull',
  fail: 'border-bear/50 bg-bear/10 text-bear',
  // Grey, and never red. A gate nobody could compute has not failed.
  unknown: 'border-term-line bg-term-raised text-term-faint',
};

const STATE_GLYPH: Record<FilterState, string> = {
  pass: '✓',
  fail: '✕',
  unknown: '?',
};

/**
 * Badge colours.
 *
 * `unknown` is grey, deliberately not amber. Amber would put it on the same
 * scale as `caution` — a judgement — when it is the absence of one.
 */
const BADGE_CLASS: Record<OptionQualityBadge, string> = {
  excellent: 'border-bull/60 bg-bull/15 text-bull',
  tradable: 'border-pos/60 bg-pos/12 text-pos',
  caution: 'border-flip/60 bg-flip/12 text-flip',
  avoid: 'border-bear/60 bg-bear/12 text-bear',
  unknown: 'border-term-line bg-term-raised text-term-faint',
};

function GateChip({ gate, state }: { gate: FilterKey; state: FilterState }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-1 text-2xs font-bold tracking-[0.06em] ${STATE_CLASS[state]}`}
    >
      {FILTER_LABEL[gate]}
      <span aria-hidden>{STATE_GLYPH[state]}</span>
      <span className="sr-only">{state}</span>
    </span>
  );
}

function OptionBadge({ badge }: { badge: OptionQualityBadge }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap border px-2 py-1 text-2xs font-bold uppercase tracking-[0.1em] ${BADGE_CLASS[badge]}`}
    >
      {OPTION_BADGE_LABEL[badge]}
    </span>
  );
}

/**
 * The contract panel: the badge, the four numbers behind it, and the reasons.
 *
 * The numbers are always shown, even under an `unknown` badge, because "we
 * could not read the spread" is a different and more useful statement than a
 * blank panel.
 */
function OptionPanel({
  quality,
  onCheck,
  checking,
  error,
}: {
  quality: OptionQuality | null;
  onCheck: () => void;
  checking: boolean;
  error: string | null;
}) {
  if (!quality) {
    return (
      <div className="border border-term-line bg-term-raised/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-xs">Option contract</span>
          <span className="text-2xs text-term-faint">not checked yet</span>
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="border border-pos/50 bg-pos/10 px-2.5 py-1 text-2xs font-bold tracking-[0.08em] text-pos transition-colors hover:bg-pos/20 disabled:opacity-40"
          >
            {checking ? 'Checking…' : 'Check the contract'}
          </button>
        </div>
        <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
          Only the top-ranked names are checked at scan time, to stay inside
          the chain provider&rsquo;s daily window — the count is stated at the
          top of this page. This one is checked on request.
        </p>
        {error && <p className="mt-1.5 text-2xs text-bear">{error}</p>}
      </div>
    );
  }

  const c = quality.contract;

  return (
    <div className="border border-term-line bg-term-raised/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-xs">Option contract</span>
        <OptionBadge badge={quality.badge} />
        <span className="text-2xs tabular-nums text-term-dim">
          {contractSummary(c)}
        </span>
        <span className="ml-auto text-2xs text-term-faint">
          {/* Provenance, stated on every badge. See OPTION_QUALITY_TOP_N. */}
          {quality.source === 'scan'
            ? 'checked at scan time'
            : 'checked on request'}
        </span>
      </div>

      {c && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4">
          <div>
            <dt className="text-term-faint">Days to expiry</dt>
            <dd className="tabular-nums text-term-text">{c.dte}</dd>
          </div>
          <div>
            <dt className="text-term-faint">Delta</dt>
            <dd className="tabular-nums text-term-text">
              {c.delta === null ? 'unknown' : c.delta.toFixed(2)}
            </dd>
          </div>
          <div>
            <dt className="text-term-faint">Open interest</dt>
            <dd className="tabular-nums text-term-text">
              {c.openInterest === null
                ? 'unknown'
                : c.openInterest.toLocaleString('en-US')}
            </dd>
          </div>
          <div>
            <dt className="text-term-faint">Spread (% of mid)</dt>
            <dd className="tabular-nums text-term-text">
              {c.spreadPctOfMid === null
                ? 'unknown'
                : `${c.spreadPctOfMid.toFixed(1)}%`}
            </dd>
          </div>
        </dl>
      )}

      <ul className="mt-2 space-y-0.5">
        {quality.reasons.map((reason) => (
          <li key={reason} className="text-2xs leading-relaxed text-term-dim">
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- one result --------------------------------------------------------------

function ResultCard({
  row: initial,
  outcome,
  nwSettings,
  trendEmaPeriod,
}: {
  row: ScanRow;
  outcome: RowOutcome;
  nwSettings: NwSettings;
  trendEmaPeriod: number;
}) {
  const [chartOpen, setChartOpen] = useState(false);
  const [quality, setQuality] = useState<OptionQuality | null>(initial.optionQuality);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The row as rendered, with any on-click grade folded in, so `whyItMatched`
  // and the watch line below it read the same contract the panel shows.
  const row: ScanRow = useMemo(
    () => ({ ...initial, optionQuality: quality }),
    [initial, quality],
  );

  const lines = whyItMatched(row);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/scanner/quality?symbol=${encodeURIComponent(row.symbol)}`,
      );
      const body = (await response.json()) as {
        quality?: OptionQuality;
        error?: string;
      };
      if (!response.ok || !body.quality) {
        setError(body.error ?? 'The contract could not be checked.');
        return;
      }
      setQuality(body.quality);
    } catch {
      setError('The contract could not be checked — the request failed.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <article className="border border-term-line bg-term-panel/60">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-term-line px-3.5 py-2.5">
        <h3 className="flex items-baseline gap-2 text-base font-bold text-term-text">
          <TickerLink symbol={row.symbol} />
          <span className="text-sm tabular-nums text-term-dim">
            {row.rsScore.toFixed(0)}/100
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {quality && <OptionBadge badge={quality.badge} />}
          <button
            type="button"
            onClick={() => setChartOpen((v) => !v)}
            aria-expanded={chartOpen}
            className="border border-term-line px-2 py-1 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
          >
            {chartOpen ? 'Hide chart' : 'Chart'}
          </button>
        </div>
      </div>

      {/*
        Why it matched, in plain English and in the order someone would ask.
        The watch line is the last row and is always present — see
        `buildWatchLine`, which returns a sentence rather than nothing when
        there is nothing to flag.
      */}
      <dl className="space-y-1 px-3.5 py-3 text-xs">
        {lines.map((line) => (
          <div key={line.label} className="flex flex-wrap gap-x-2">
            <dt
              className={`w-20 shrink-0 font-bold tracking-[0.06em] ${
                line.label === 'Watch' ? 'text-flip' : 'text-term-faint'
              }`}
            >
              {line.label}:
            </dt>
            <dd
              className={`min-w-0 flex-1 leading-relaxed ${
                line.label === 'Watch' ? 'text-flip' : 'text-term-dim'
              }`}
            >
              {line.text}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2 px-3.5 pb-3">
        <OptionPanel
          quality={quality}
          onCheck={check}
          checking={checking}
          error={error}
        />

        {/*
          The name's own dealer positioning. Context text, not a gate — and the
          single-name caveat travels with it every time it is shown.
        */}
        {row.regime !== null && (
          <p className="text-2xs leading-relaxed text-term-faint">
            <span className="label-xs mr-1.5">Positioning</span>
            This name&rsquo;s own dealer positioning reads{' '}
            <span className={row.regime === 'positive' ? 'text-pos' : 'text-neg'}>
              {row.regime === 'positive' ? 'calm' : 'volatile'}
            </span>
            {row.netGex !== null && ` (${formatUsd(row.netGex)} net)`}. On a single
            stock the assumption about which way dealers are positioned is far
            weaker than it is on an index, so this is shown as context and is not
            one of the gates.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {FILTER_KEYS.map((key) => (
            <GateChip key={key} gate={key} state={outcome.verdicts[key]?.state ?? 'unknown'} />
          ))}
        </div>
      </div>

      {chartOpen && (
        <div className="border-t border-term-line px-3.5 pb-4 pt-3">
          <ScannerChart
            symbol={row.symbol}
            magnets={row.magnets}
            nwSettings={nwSettings}
            trendEmaPeriod={trendEmaPeriod}
          />
        </div>
      )}
    </article>
  );
}

// --- the board ---------------------------------------------------------------

export function ScannerBoard({
  scan,
  nwSettings,
  trendEmaPeriod,
  gammaTimeEt,
  scannedAtEt,
}: {
  scan: ScanResult;
  nwSettings: NwSettings;
  trendEmaPeriod: number;
  gammaTimeEt: string;
  /**
   * New York clock the scan actually ran at, computed on the server.
   *
   * The heading states this rather than the time the job was *scheduled* for.
   * They are normally the same, and when they are not the reader needs to know.
   */
  scannedAtEt: string;
}) {
  const { passed, all, biggestEliminator } = useMemo(
    () => partition(scan.rows),
    [scan.rows],
  );

  const gammaStamp = scan.gammaDate
    ? `gamma as of ${gammaTimeEt} ET on ${scan.gammaDate}`
    : 'no same-day gamma';

  return (
    <div className="space-y-4">
      <div className="panel px-3.5 py-3">
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
            readings below were taken then.
          </p>
        )}
        <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
          Contracts were checked at scan time for the top {scan.qualityChecked}{' '}
          ranked name{scan.qualityChecked === 1 ? '' : 's'}. Any result below
          that is checked when you open it — the chain provider answers a
          limited number of requests a day, and the morning gamma job has first
          call on them.
        </p>
      </div>

      {/*
        The five rules, stated in full and in plain English above the list.
        Behind a tooltip they were, in effect, not stated at all.
      */}
      <section className="panel px-3.5 py-3">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-dim">
          The five rules, all of which must pass
        </h2>
        <ol className="mt-2 space-y-1.5">
          {FILTER_KEYS.map((key, i) => (
            <li key={key} className="flex gap-2 text-xs leading-relaxed">
              <span className="shrink-0 tabular-nums text-term-faint">{i + 1}.</span>
              <span>
                <span className="font-bold text-term-text">{FILTER_LABEL[key]}</span>
                <span className="text-term-dim"> — {FILTER_EXPLANATION[key]}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2.5 text-2xs leading-relaxed text-term-faint">
          Names reporting earnings within the next 10 days are removed
          altogether. Contracts are then checked between{' '}
          {OPTION_WINDOW.minDte} and {OPTION_WINDOW.maxDte} days to expiry at a
          delta of {OPTION_WINDOW.minDelta} to {OPTION_WINDOW.maxDelta}. A good
          stock with an untradable contract is not a result worth having.
        </p>
      </section>

      {scan.earningsExcluded.length > 0 && (
        <p className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-term-dim">
          <span className="label-xs mr-1.5">Removed for earnings</span>
          {scan.earningsExcluded
            .map((e) => `${e.symbol} (${e.dateIso}, ${e.daysAway}d)`)
            .join(' · ')}
        </p>
      )}

      <p className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-term-faint">
        <span className="label-xs mr-1.5">Earnings dates</span>
        {scan.earningsSource} Where a date could not be established the name is
        kept and its watch line says so — an unknown date is never treated as
        &ldquo;no earnings soon&rdquo;.
      </p>

      {scan.gateReason ? (
        <div className="panel border-l-2 border-l-bear/60 px-4 py-8 text-center text-xs">
          <p className="font-bold text-bear">
            The market is in a volatile regime. The scan is empty.
          </p>
          <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
            This is one market-wide gate and it is shut. When dealers amplify
            moves rather than damping them, a list of individually
            strong-looking names is at its most misleading. {scan.candidates}{' '}
            names cleared RS {scan.rsMin} and were not carried further. There is
            no setting that relaxes this: an empty list on a day like today is
            the correct output.
          </p>
        </div>
      ) : passed.length === 0 ? (
        <div className="panel px-4 py-8 text-center text-xs">
          <p className="font-bold text-term-text">
            No names passed today&rsquo;s five rules.
          </p>
          <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
            A zero-result day is a real answer, not a broken page.{' '}
            {biggestEliminator ? (
              <>
                The rule that eliminated the most candidates was{' '}
                <span className="text-flip">
                  {FILTER_LABEL[biggestEliminator.key]}
                </span>
                , which knocked out {biggestEliminator.count} of{' '}
                {scan.candidates}.
              </>
            ) : (
              <>No candidates cleared RS {scan.rsMin} to begin with.</>
            )}{' '}
            Every candidate and its five gate states is below.
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="sr-only">Names passing all five rules</h2>
          {passed.map(({ row, outcome }) => (
            <ResultCard
              key={row.symbol}
              row={row}
              outcome={outcome}
              nwSettings={nwSettings}
              trendEmaPeriod={trendEmaPeriod}
            />
          ))}
        </section>
      )}

      {/*
        Always present. When the market gate is shut the pass list is empty by
        definition, and without this a gate-closed morning would render a page
        with no rows on it at all — every candidate's five gate states, which
        the scan computed and stored, would be invisible. A zero-result day has
        to show its working.
      */}
      <details className="panel group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className="text-term-faint transition-transform group-open:rotate-90"
          >
            ▸
          </span>
          <span className="font-bold uppercase tracking-[0.14em] text-term-dim">
            Every candidate scanned
          </span>
          <span className="text-term-faint">
            {all.length} name{all.length === 1 ? '' : 's'} above RS {scan.rsMin},
            with all five gate states
          </span>
        </summary>

        {all.length === 0 ? (
          <p className="border-t border-term-line px-3.5 py-6 text-center text-2xs text-term-faint">
            No names cleared RS {scan.rsMin}, so nothing was carried into the
            rest of the pipeline.
          </p>
        ) : (
          <div className="scroll-term overflow-x-auto border-t border-term-line">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <caption className="sr-only">
                Every candidate above the relative-strength floor, with all five
                gate states.
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-left text-2xs font-bold uppercase tracking-[0.1em] text-term-dim"
                  >
                    Ticker
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-right text-2xs font-bold uppercase tracking-[0.1em] text-term-dim"
                  >
                    RS
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-left text-2xs font-bold uppercase tracking-[0.1em] text-term-dim"
                  >
                    Gates
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-left text-2xs font-bold uppercase tracking-[0.1em] text-term-dim"
                  >
                    What stopped it
                  </th>
                </tr>
              </thead>
              <tbody>
                {all.map(({ row, outcome }) => (
                  <tr key={row.symbol}>
                    <th
                      scope="row"
                      className="border-b border-term-line/60 px-2.5 py-2 text-left align-top font-bold text-term-text"
                    >
                      <TickerLink symbol={row.symbol} />
                    </th>
                    <td className="border-b border-term-line/60 px-2.5 py-2 text-right align-top tabular-nums text-term-text">
                      {row.rsScore.toFixed(0)}
                    </td>
                    <td className="border-b border-term-line/60 px-2.5 py-2 align-top">
                      <div className="flex flex-wrap gap-1">
                        {FILTER_KEYS.map((key) => (
                          <GateChip
                            key={key}
                            gate={key}
                            state={outcome.verdicts[key]?.state ?? 'unknown'}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="border-b border-term-line/60 px-2.5 py-2 align-top text-2xs leading-relaxed text-term-dim">
                      {outcome.passes ? 'Nothing — it passed.' : outcome.failingLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
