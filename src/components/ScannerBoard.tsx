'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { ScannerChart } from '@/components/ScannerChart';
import { ScannerControls } from '@/components/ScannerControls';
import { TickerLink } from '@/components/TickerLink';
import { formatUsd } from '@/lib/format';
import { buildWatchLine, whyItMatched, whyItRanks } from '@/lib/scanner/evaluate';
import {
  isDefault as settingsAreDefault,
  paramsFromSettings,
  readLocationSearch,
  readLocationSearchOnServer,
  settingsFromParams,
  subscribeLocationSearch,
} from '@/lib/scanner/filterState';
import type { NwSettings } from '@/lib/scanner/nadarayaWatson';
import { contractSummary } from '@/lib/scanner/optionQuality';
import {
  buildFunnel,
  DEFAULT_FILTERS,
  describeTrendParts,
  MARKET_REGIME_NOTE,
  SCORE_EXPLANATION,
  SCORE_KEYS,
  SCORE_LABEL,
  SCORE_WEIGHTS,
  scoreAndJudge,
  type FilterSettings,
  type FunnelStage,
  type MarketContext,
  type ScoreKey,
  type ScoredRow,
} from '@/lib/scanner/score';
import {
  OPTION_BADGE_LABEL,
  RULE_EXPLANATION,
  RULE_KEYS,
  RULE_LABEL,
  RULE_SHORT,
  SCANNER_TOP_N,
  type FilterState,
  type OptionQuality,
  type OptionQualityBadge,
  type RuleKey,
  type ScanResult,
} from '@/lib/scanner/types';

/**
 * The scanner's rendered output.
 *
 * ## It ranks. It does not gate, and it does not recommend.
 *
 * The previous version ANDed five rules together and printed the survivors.
 * Two runs in a row that was zero names out of 503, and the page had nothing
 * to say about it — no ordering, no counts, no way to see which rule had eaten
 * the list. An empty page is a dead page.
 *
 * So: every scored name gets a 0-100 composite, the list is ordered by it, and
 * the top of that order is always on screen. The rows that clear every rule in
 * force come first; the rest fill the table below them, dimmed, with their
 * failed rules in red and the number that failed them printed beside it.
 *
 * The dimming is the whole ethical load of this page and it is worth being
 * explicit about. Rank is an ordering, not an endorsement. A name at the top
 * of this table with two red badges is at the top because nothing scored
 * higher, not because it is a good idea — and it must never be possible to
 * read it as the second thing. That is why failures are never hidden, never
 * collapsed behind a toggle, and never sorted out of view.
 */

// --- small pieces ------------------------------------------------------------

const STATE_CLASS: Record<FilterState, string> = {
  pass: 'border-bull/50 bg-bull/15 text-bull',
  fail: 'border-bear/50 bg-bear/10 text-bear',
  // Grey, and never red. A rule nobody could evaluate has not failed.
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

/**
 * One filter's state on one row.
 *
 * The reading travels with the colour, in the `title` and in the screen-reader
 * text, because a red chip labelled `VOL` is a colour a reader has to take on
 * trust. A disabled filter keeps its chip and loses its colour: switching a
 * filter off must not be able to delete the number it was measuring.
 */
function RuleBadge({
  rule,
  state,
  detail,
  enabled,
}: {
  rule: RuleKey;
  state: FilterState;
  detail: string;
  enabled: boolean;
}) {
  return (
    <span
      title={`${RULE_LABEL[rule]}: ${detail}${enabled ? '' : ' (filter switched off)'}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-0.5 text-2xs font-bold tracking-[0.06em] ${
        enabled ? STATE_CLASS[state] : 'border-term-line/60 text-term-faint/70'
      }`}
    >
      {RULE_SHORT[rule]}
      <span aria-hidden>{STATE_GLYPH[state]}</span>
      <span className="sr-only">
        {RULE_LABEL[rule]} {state}: {detail}
        {enabled ? '' : ' — this filter is switched off'}
      </span>
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

// --- the sortable component headers ------------------------------------------

/**
 * One component column's heading, with the tooltip that says what it measures.
 *
 * The tooltip is the point, not decoration. "Trend" as a bare column heading
 * over a number between 0 and 100 is a number a reader has to take on trust;
 * the bubble says, in plain English, that it is four readings averaged and
 * names all four. Every component column carries one, from `SCORE_EXPLANATION`
 * — the same wording the list under the table uses, so the two cannot drift.
 */
function SortableHead({
  component,
  sort,
  onSort,
}: {
  component: ScoreKey;
  sort: { key: ScoreKey; dir: 'desc' | 'asc' } | null;
  onSort: (next: { key: ScoreKey; dir: 'desc' | 'asc' } | null) => void;
}) {
  const active = sort?.key === component ? sort.dir : null;

  return (
    <th
      scope="col"
      aria-sort={
        active === null ? 'none' : active === 'desc' ? 'descending' : 'ascending'
      }
      className={`${HEAD_CLASS} text-right`}
    >
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() =>
            onSort(
              active === null
                ? { key: component, dir: 'desc' }
                : active === 'desc'
                  ? { key: component, dir: 'asc' }
                  : null,
            )
          }
          title={`${SCORE_LABEL[component]} — ${SCORE_EXPLANATION[component]} Click to sort these twenty rows by it.`}
          className={`uppercase tracking-[0.1em] transition-colors ${
            active ? 'text-pos' : 'hover:text-term-text'
          }`}
        >
          {SCORE_LABEL[component]}
          <span aria-hidden>{active === 'desc' ? ' ↓' : active === 'asc' ? ' ↑' : ''}</span>
        </button>
        <InfoTip
          tip={{
            label: SCORE_LABEL[component],
            plain: SCORE_EXPLANATION[component],
            detail:
              'Scored 0-100 and blended into the composite at the weight shown under the table. A dash means it could not be measured for this name — which is left out of the blend, never counted as zero.',
          }}
        />
      </span>
    </th>
  );
}

// --- the funnel --------------------------------------------------------------

/**
 * Where the list drops out, in one clickable row.
 *
 * This is the piece that was missing, and the reason the zero-result mornings
 * were unreadable. Five ANDed rules produce one number — how many survived —
 * and that number cannot tell you whether the market had no strong names or
 * the option window was set somewhere nothing lives. The stages are cumulative
 * and in the order a reader would ask them, so the arithmetic is checkable by
 * eye, and clicking one shows exactly the names that reached it.
 */
function FunnelStrip({
  stages,
  active,
  onSelect,
}: {
  stages: FunnelStage[];
  active: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <section className="panel px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {stages.map((stage, i) => (
          <span key={stage.key} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="px-0.5 text-term-faint">
                →
              </span>
            )}
            <button
              type="button"
              aria-pressed={active === stage.key}
              onClick={() => onSelect(active === stage.key ? null : stage.key)}
              className={`border px-2 py-1 text-2xs tracking-[0.06em] transition-colors ${
                active === stage.key
                  ? 'border-pos/70 bg-pos/15 text-pos'
                  : 'border-term-line text-term-dim hover:border-pos/50 hover:text-pos'
              }`}
            >
              <span className="font-bold tabular-nums">{stage.count}</span>{' '}
              <span className="text-term-faint">{stage.label}</span>
              {stage.untested > 0 && (
                <span
                  className="text-term-faint/80"
                  title={`${stage.untested} of these could not be tested against this filter at all — no reading was available. They are not counted as having cleared it.`}
                >
                  {' '}
                  ({stage.untested} untested)
                </span>
              )}
            </button>
          </span>
        ))}
        {active && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-1 border border-term-line px-2 py-1 text-2xs text-term-faint transition-colors hover:text-term-text"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mt-2 text-2xs leading-relaxed text-term-faint">
        Each count is the names that cleared that step <em>and every step
        before it</em>, so the numbers only ever go down and you can check the
        arithmetic by eye. A name that could not be tested against a filter at
        all &mdash; no chain pulled for it, no history to measure &mdash; stays
        in the count and is reported beside it as untested, because a filter
        cannot fail a name it never read. Click a step to mark, in the table
        below, which of the twenty rows reached it. It marks rather than filters: a stage that
        nothing reaches is a number worth reading, and hiding the rows it
        excluded would leave you nothing to compare it against.
      </p>
    </section>
  );
}

// --- the contract panel ------------------------------------------------------

function OptionPanel({
  quality,
  onCheck,
  checking,
  error,
  contractTopN,
}: {
  quality: OptionQuality | null;
  onCheck: () => void;
  checking: boolean;
  error: string | null;
  contractTopN: number;
}) {
  if (!quality) {
    return (
      <div className="border border-term-line bg-term-raised/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-xs">Option contract</span>
          <span className="text-2xs text-term-faint">not checked</span>
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
          Only the top {contractTopN} names by score have a chain pulled at scan
          time, to stay inside the chain provider&rsquo;s daily window. An
          unchecked contract is <span className="text-term-dim">unknown</span>,
          not bad — this name has not failed the contract rule, nobody has
          tested it. Check it here.
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
          {/* Provenance, stated on every badge. */}
          {quality.source === 'scan' ? 'checked at scan time' : 'checked on request'}
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

// --- the component columns ---------------------------------------------------

/**
 * Columns in the table, counted once.
 *
 * Rank, ticker, score, seven components, turnover, filters, what stopped it,
 * and the detail button. Kept as a constant because three `colSpan`s depend on
 * it and a table whose spans disagree with its header silently loses a column
 * on some browsers and not others.
 */
const COLUMN_COUNT = 3 + SCORE_KEYS.length + 4;

/**
 * The reading behind one component, for its cell tooltip.
 *
 * Every number on this page has to be checkable without opening anything. The
 * cell shows the 0-100 component; hovering it says what that component was
 * measured from, in the same words the filter verdict uses, so the two cannot
 * come apart.
 */
function componentDetail(key: ScoreKey, scored: ScoredRow): string {
  const { row, verdicts, score } = scored;
  const m = row.metrics;

  switch (key) {
    case 'rs':
      return `${verdicts.rs.detail} — #${m.rsRank} in the index.`;
    case 'trend':
      return `${describeTrendParts(score.trend)}. ${
        score.trend.measured === 4
          ? 'All four readings were available.'
          : `${score.trend.measured} of the four readings were available; the rest are left out rather than counted against it.`
      }`;
    case 'volume':
      return verdicts.volume.detail;
    case 'vwap':
      return verdicts.vwap.detail;
    case 'tickerGamma':
      return verdicts.gamma.detail;
    case 'spyGamma':
      return verdicts.spy.detail;
    case 'optionLiquidity':
      return row.optionsVolume === null || row.optionsOpenInterest === null
        ? 'No chain was pulled for this name this morning, so its option liquidity was not measured. That is unknown, not poor — it is left out of the score rather than counted as zero.'
        : `${row.optionsVolume.toLocaleString('en-US')} contracts traded and ${row.optionsOpenInterest.toLocaleString('en-US')} open across the whole chain. The score is the weaker of the two.`;
  }
}

/**
 * One component's 0-100 on one row.
 *
 * An unmeasured component says "no data" in grey. Not a zero, and not a dash
 * either — a dash is ambiguous enough that a reader scanning a column of
 * numbers will read it as "nothing there", which is one short step from
 * "nothing good there". The words are unambiguous, and the tooltip says which
 * reading was missing and why.
 *
 * It costs the component nothing: the blend renormalises over what was
 * measured, and a filter cannot fail a name on a reading nobody took.
 */
function ComponentCell({
  component,
  value,
  detail,
}: {
  component: ScoreKey;
  value: number | null;
  detail: string;
}) {
  return (
    <td
      title={`${SCORE_LABEL[component]}: ${detail}`}
      className={`border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums ${
        value === null ? 'text-term-faint' : 'text-term-dim'
      }`}
    >
      {value === null ? (
        <span className="text-2xs italic tracking-tight">no data</span>
      ) : (
        value.toFixed(0)
      )}
      <span className="sr-only">
        {' '}
        {SCORE_LABEL[component]}: {value === null ? 'not measured' : value.toFixed(0)}. {detail}
      </span>
    </td>
  );
}

// --- one row -----------------------------------------------------------------


function ResultRow({
  scored,
  settings,
  rank,
  inStage,
  nwSettings,
  trendEmaPeriod,
  contractTopN,
  onGraded,
}: {
  scored: ScoredRow;
  settings: FilterSettings;
  rank: number;
  /**
   * Whether this row reached the funnel stage the reader clicked, or null when
   * no stage is selected. Marks the row; never removes it.
   */
  inStage: boolean | null;
  nwSettings: NwSettings;
  trendEmaPeriod: number;
  contractTopN: number;
  /** Hoisted so a grade fetched here survives a re-filter and re-scores. */
  onGraded: (symbol: string, quality: OptionQuality) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    row,
    verdicts,
    score,
    failing,
    failingLabel,
    unmeasured,
    unmeasuredLabel,
    earningsExcluded,
  } = scored;
  const m = row.metrics;

  /*
   * Dimmed, not hidden. A row that failed something is still the row the
   * ranking put here, and the reader has to be able to see both facts at once
   * — which is exactly what the old page could not do, because a failing name
   * simply was not on it.
   *
   * Untested is deliberately not dimmed. Dimming is this table's way of saying
   * "this one missed something", and a name whose chain nobody pulled has
   * missed nothing — dimming it would render the request budget as a verdict
   * on the stock, in the most literal way available: by making it fainter.
   */
  const dimmed = failing.length > 0 || earningsExcluded;

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
      onGraded(row.symbol, body.quality);
    } catch {
      setError('The contract could not be checked — the request failed.');
    } finally {
      setChecking(false);
    }
  };

  const watch = buildWatchLine(row, settings.earningsBufferDays).text;

  return (
    <>
      <tr
        className={`${dimmed ? 'opacity-60' : ''}${
          inStage ? ' bg-pos/5' : ''
        }`}
      >
        <td className="border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums text-term-faint">
          {rank}
          {inStage && (
            <span className="sr-only"> — reached the selected funnel stage</span>
          )}
        </td>
        <th
          scope="row"
          className="border-b border-term-line/60 px-2 py-2 text-left align-top font-bold text-term-text"
        >
          <TickerLink symbol={row.symbol} />
        </th>
        <td className="border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums font-bold text-term-text">
          {score.total.toFixed(0)}
        </td>
        {/*
          The seven components, each on the same 0-100 scale as the score they
          add up to. This is what makes the composite checkable rather than
          authoritative: a reader can see that a name is at the top on strength
          and volume and is carrying an unmeasured gamma, rather than being
          handed one number and asked to trust it.
        */}
        {SCORE_KEYS.map((key) => (
          <ComponentCell
            key={key}
            component={key}
            value={score.components[key]}
            detail={componentDetail(key, scored)}
          />
        ))}
        <td className="border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums text-term-dim">
          {formatUsd(m.avgDollarVolume)}
        </td>
        <td className="border-b border-term-line/60 px-2 py-2 align-top">
          <div className="flex flex-wrap gap-1">
            {RULE_KEYS.map((key) => (
              <RuleBadge
                key={key}
                rule={key}
                state={verdicts[key].state}
                detail={verdicts[key].detail}
                enabled={settings.enabled[key]}
              />
            ))}
          </div>
        </td>
        <td className="border-b border-term-line/60 px-2 py-2 align-top text-2xs leading-relaxed text-term-dim">
          {earningsExcluded ? (
            <span className="text-flip">
              Reports in {row.earnings.daysAway} days ({row.earnings.dateIso}) —
              inside your {settings.earningsBufferDays}-day buffer.
            </span>
          ) : (
            <>
              {/*
                Failed and untested are two different columns' worth of
                meaning crammed into one cell, so they are rendered as two
                separate sentences in two different colours. A name that
                missed nothing but could not be tested on three filters is
                not a match in the same sense as one that passed all three,
                and the cell has to be able to say which.
              */}
              {failing.length > 0 && <span className="text-bear">{failingLabel}</span>}
              {failing.length === 0 && unmeasured.length === 0 && (
                <span className="text-bull">Matches every filter in force.</span>
              )}
              {failing.length === 0 && unmeasured.length > 0 && (
                <span className="text-bull">
                  Missed nothing it could be tested on.
                </span>
              )}
              {unmeasured.length > 0 && (
                <span className="block text-term-faint">
                  Not tested: {unmeasuredLabel}
                </span>
              )}
            </>
          )}
        </td>
        <td className="border-b border-term-line/60 px-2 py-2 align-top">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="border border-term-line px-2 py-1 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
          >
            {open ? 'Less' : 'Detail'}
          </button>
        </td>
      </tr>

      {/*
        Two lines under every row, side by side, and neither behind the Detail
        toggle.

        The green account and the red one are rendered together on purpose. A
        page that puts the reasons a name looks interesting on screen and the
        reasons to be careful one click away has stopped describing a stock and
        started arguing for it. So they share a row, in the same type size, and
        the reader sees both or neither.
      */}
      <tr className={dimmed ? 'opacity-60' : undefined}>
        <td />
        <td
          colSpan={COLUMN_COUNT - 1}
          className="border-b border-term-line/60 px-2 pb-2"
        >
          <div className="grid gap-1 sm:grid-cols-2 sm:gap-4">
            <p className="text-2xs leading-relaxed text-term-dim">
              <span className="font-bold tracking-[0.06em] text-term-faint">
                Why it&rsquo;s on the list:{' '}
              </span>
              {whyItMatched(score, row)}
            </p>
            <p className="text-2xs leading-relaxed text-flip">
              <span className="font-bold tracking-[0.06em]">Watch: </span>
              {watch}
            </p>
          </div>
        </td>
      </tr>

      {open && (
        <tr>
          <td />
          <td
            colSpan={COLUMN_COUNT - 1}
            className="border-b border-term-line px-2 pb-4 pt-1"
          >
            <div className="space-y-2.5">
              <dl className="space-y-1 text-xs">
                {whyItRanks(scored, settings)
                  .filter((line) => line.label !== 'Watch')
                  .map((line) => (
                    <div key={line.label} className="flex flex-wrap gap-x-2">
                      <dt className="w-20 shrink-0 font-bold tracking-[0.06em] text-term-faint">
                        {line.label}:
                      </dt>
                      <dd className="min-w-0 flex-1 leading-relaxed text-term-dim">
                        {line.text}
                      </dd>
                    </div>
                  ))}
              </dl>

              {/* What the score is made of, so the number is checkable. */}
              <p className="text-2xs leading-relaxed text-term-faint">
                <span className="label-xs mr-1.5">Score {score.total.toFixed(1)}</span>
                {SCORE_KEYS.map((key) => {
                  const value = score.components[key];
                  return `${SCORE_LABEL[key]} ${
                    value === null ? 'not measured' : value.toFixed(0)
                  } × ${SCORE_WEIGHTS[key]}`;
                }).join(' · ')}
                {score.missing.length > 0 && (
                  <>
                    {' '}
                    — {score.missing.length} component
                    {score.missing.length === 1 ? '' : 's'} had no reading and
                    {score.missing.length === 1 ? ' was' : ' were'} left out of
                    the blend rather than scored zero. A reading nobody took is
                    not a bad reading.
                  </>
                )}
              </p>

              <OptionPanel
                quality={row.optionQuality}
                onCheck={check}
                checking={checking}
                error={error}
                contractTopN={contractTopN}
              />

              {row.regime !== null && (
                <p className="text-2xs leading-relaxed text-term-faint">
                  <span className="label-xs mr-1.5">Positioning</span>
                  This name&rsquo;s own dealer positioning reads{' '}
                  <span className={row.regime === 'positive' ? 'text-pos' : 'text-neg'}>
                    {row.regime === 'positive' ? 'calm' : 'volatile'}
                  </span>
                  {row.netGex !== null && ` (${formatUsd(row.netGex)} net)`}. On a
                  single stock the assumption about which way dealers are
                  positioned is far weaker than it is on an index, so this is
                  context and is not one of the rules.
                </p>
              )}

              <button
                type="button"
                onClick={() => setChartOpen((v) => !v)}
                aria-expanded={chartOpen}
                className="border border-term-line px-2.5 py-1 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
              >
                {chartOpen ? 'Hide chart' : 'Chart'}
              </button>

              {chartOpen && (
                <ScannerChart
                  symbol={row.symbol}
                  magnets={row.magnets}
                  nwSettings={nwSettings}
                  trendEmaPeriod={trendEmaPeriod}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- the board ---------------------------------------------------------------

const HEAD_CLASS =
  'whitespace-nowrap border-b border-term-edge bg-term-raised px-2 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';

export function ScannerBoard({
  scan,
  nwSettings,
  trendEmaPeriod,
  gammaTimeEt,
  scannedAtEt,
  contractTopN,
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
  /** How many rows are rendered, and how many had contracts pulled. */
  contractTopN: number;
}) {
  const [stage, setStage] = useState<string | null>(null);
  /** Which component column the visible rows are sorted on. Null = by score. */
  const [sort, setSort] = useState<{ key: ScoreKey; dir: 'desc' | 'asc' } | null>(
    null,
  );

  /*
   * On-demand grades, held here rather than in the row.
   *
   * A grade fetched from an expanded row changes that name's contract rule and
   * therefore its score and its place in the order. Keeping it in the row
   * component would leave the badge updated and the ranking stale, so the two
   * would disagree about the same contract on the same screen.
   */
  const [graded, setGraded] = useState<Record<string, OptionQuality>>({});

  /*
   * ## Where the settings actually live
   *
   * In the address bar. Not in state with the URL kept in sync behind it — in
   * it, as the single source of truth, with component state holding only what
   * the reader has changed since the page loaded.
   *
   * The reason is that a pasted link has to reproduce a list exactly. Anything
   * that reads the URL once and then diverges from it will, sooner or later,
   * show one configuration in the address bar and a different one in the
   * table, and a shared link is worthless the moment that can happen.
   *
   * `window.location` does not exist during server rendering, so it is read
   * through `useSyncExternalStore`: the server snapshot is an empty query
   * string, which renders the shipped defaults, and React re-renders with the
   * real one once hydrated. That is precisely the problem the hook exists for,
   * and it avoids both a hydration mismatch and a mount effect that would
   * paint the wrong list first.
   */
  const search = useSyncExternalStore(
    subscribeLocationSearch,
    readLocationSearch,
    readLocationSearchOnServer,
  );

  const fromUrl = useMemo(
    () => settingsFromParams(new URLSearchParams(search)),
    [search],
  );

  const [changed, setChanged] = useState<FilterSettings | null>(null);
  const settings = changed ?? fromUrl;
  const setSettings = useCallback((next: FilterSettings) => setChanged(next), []);

  /*
   * ...and written on every change, with `replaceState` rather than the router.
   *
   * A router navigation on a `force-dynamic` page is a request to the server,
   * which is the one thing a slider must never cause: the scan spends the
   * chain provider's daily budget and the page has to be filterable without
   * touching it. `replaceState` also keeps the back button meaning "the page
   * before this one" rather than "one notch left on the RS slider".
   */
  useEffect(() => {
    /*
     * Nothing is written until the reader has actually moved something.
     *
     * This guard is load-bearing, and the bug it fixes is worth recording.
     * `useSyncExternalStore` renders the *server* snapshot during hydration —
     * an empty query string, which is the defaults — and only re-renders with
     * the real one afterwards. An unconditional write therefore fired once
     * with the defaults and replaced a link like `?rs=72&vol=1.4` with a bare
     * `/scanner` before the real settings had ever been read. The shared
     * configuration was gone, and because the address bar is the source of
     * truth here, gone for good: the next read found nothing to restore.
     *
     * While `changed` is null the page is simply showing what the URL says,
     * so there is nothing to write back.
     */
    if (changed === null) return;

    const query = paramsFromSettings(changed);
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== url) {
      window.history.replaceState(null, '', url);
    }
  }, [changed]);

  const rows = useMemo(
    () =>
      scan.rows.map((row) =>
        graded[row.symbol] ? { ...row, optionQuality: graded[row.symbol] } : row,
      ),
    [scan.rows, graded],
  );

  /*
   * SPY's regime, resolved once and passed down. It is one of the seven
   * components and one of the eight filters, and the stored scan holds it in
   * exactly one place — see `MarketContext`.
   */
  const market: MarketContext = useMemo(
    () => ({ spyRegime: scan.spyRegime }),
    [scan.spyRegime],
  );

  const judged = useMemo(
    () => scoreAndJudge(rows, settings, market),
    [rows, settings, market],
  );
  const stages = useMemo(() => buildFunnel(judged, settings), [judged, settings]);

  const onGraded = useCallback(
    (symbol: string, quality: OptionQuality) =>
      setGraded((current) => ({ ...current, [symbol]: quality })),
    [],
  );

  const regime = scan.spyRegime ?? 'unknown';

  /*
   * ## What ends up on screen, and why it can never be empty
   *
   * Names matching every filter in force come first, in score order. The table
   * is then padded to `SCANNER_TOP_N` with the next-highest scorers, dimmed
   * and carrying their red badges.
   *
   * Both halves matter. Without the first, moving a control would not visibly
   * re-partition anything — the score does not depend on the filters, so the
   * top of the raw ranking barely moves. Without the second, a morning where
   * nothing matches renders an empty table, which is the failure this whole
   * page exists to prevent: an empty page cannot tell you which filter ate the
   * list, how close anything came, or whether the market or the settings were
   * the problem.
   *
   * The funnel above can still read zero. That is the honest number and it is
   * printed; it just no longer takes the table down with it.
   */
  const { shown, matchingCount } = useMemo(() => {
    const stageEntry = stages.find((s) => s.key === stage);
    const allowed = stageEntry ? new Set(stageEntry.symbols) : null;

    const matching = judged.filter(
      (entry) => entry.passes && !entry.earningsExcluded,
    );
    const matchingSymbols = new Set(matching.map((entry) => entry.row.symbol));
    const rest = judged.filter(
      (entry) => !matchingSymbols.has(entry.row.symbol),
    );

    const top = [...matching, ...rest].slice(0, SCANNER_TOP_N);

    /*
     * A selected funnel stage highlights rather than filters, for the same
     * reason everything else here does: clicking "3 cleared RS 80" used to
     * leave three rows on screen and hide the seventeen the reader was
     * comparing them against.
     */
    return {
      shown: top.map((entry) => ({
        entry,
        inStage: allowed ? allowed.has(entry.row.symbol) : null,
      })),
      matchingCount: matching.length,
    };
  }, [judged, stages, stage]);

  /*
   * ## Sorting reorders the twenty; it never chooses them
   *
   * The list is the top `SCANNER_TOP_N` by composite score, always, and a sort
   * on one column rearranges those twenty rather than pulling in a
   * twenty-first. Otherwise sorting by any single component would quietly
   * replace the ranked list with a one-factor screen wearing the ranked list's
   * heading — which is the thing the composite exists to avoid. The caption
   * says so.
   */
  const sorted = useMemo(() => {
    if (sort === null) return shown;
    const factor = sort.dir === 'desc' ? 1 : -1;
    return [...shown].sort((a, b) => {
      const av = a.entry.score.components[sort.key];
      const bv = b.entry.score.components[sort.key];
      // Unmeasured sorts to the bottom in both directions. It is not a low
      // reading and it must not be ordered as one.
      if (av === null && bv === null) {
        return a.entry.row.symbol.localeCompare(b.entry.row.symbol);
      }
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return a.entry.row.symbol.localeCompare(b.entry.row.symbol);
      return (bv - av) * factor;
    });
  }, [shown, sort]);

  const isDefault = settingsAreDefault(settings);
  const shareUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}${window.location.pathname}${
          paramsFromSettings(settings) ? `?${paramsFromSettings(settings)}` : ''
        }`;

  /*
   * Counted from the rows on screen rather than read off a stored number.
   *
   * The stored `coverage` block says what the run measured; this counts what
   * the document actually contains. They should agree, and when a document
   * predates the coverage block there is still a real number here rather than
   * a blank — but it is always the rows, never an assumption, that decide what
   * the header claims.
   */
  const gammaCoverage = useMemo(() => {
    const withGamma = scan.rows.filter((row) => row.regime !== null).length;
    return {
      withGamma,
      partial: withGamma < scan.rows.length,
      sourceNote:
        scan.coverage?.gammaSource ??
        'The chain source for this run was not recorded.',
    };
  }, [scan.rows, scan.coverage]);

  const gammaStamp = scan.gammaDate
    ? `gamma as of ${gammaTimeEt} ET on ${scan.gammaDate}`
    : 'no same-day gamma';

  return (
    <div className="space-y-4">
      {/* --- the market regime, once ---------------------------------------- */}
      <div
        className={`panel border-l-2 px-3.5 py-3 text-xs leading-relaxed ${
          regime === 'positive'
            ? 'border-l-pos/60'
            : regime === 'negative'
              ? 'border-l-bear/60'
              : 'border-l-term-line'
        }`}
      >
        <p className="text-term-text">
          <span className="label-xs mr-1.5">Market regime</span>
          {MARKET_REGIME_NOTE[regime]}
        </p>
        <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
          One market-wide condition, stated once. It is one of the seven
          scoring components and one of the eight filters, and because it is
          identical for every stock in the index it lifts or lowers the whole
          list without changing the order of it. It used to be a per-name gate,
          which is how this page went blank on volatile mornings.
        </p>
      </div>

      <div className="panel px-3.5 py-3">
        {/*
          ## The header states coverage, not intent
          
          "The S&P 500, scored" is a claim about what this page meant to do.
          The three numbers below are what it did: how many names were scored,
          how many of those actually had a dealer-positioning reading, and how
          many match the filters in force. The middle one is the one that used
          to be invisible — the chain provider decided it, it moved between 40
          and 500 depending on which provider served the morning, and nothing
          on screen said so. It is never rounded and never inferred.
        */}
        <p className="text-xs text-term-text">
          <span className="font-bold">
            Scanned at {scannedAtEt} ET · {scan.scored} scored ·{' '}
            <span className={gammaCoverage.partial ? 'text-flip' : undefined}>
              {gammaCoverage.withGamma} with gamma data
            </span>{' '}
            · {matchingCount} match every filter in force
          </span>{' '}
          <span className="text-term-dim">· {gammaStamp}</span>
        </p>
        {gammaCoverage.partial && (
          <p className="mt-1 text-2xs leading-relaxed text-flip/90">
            {scan.scored - gammaCoverage.withGamma} of the {scan.scored} scored
            names carry no dealer-positioning reading, so their gamma and
            option-liquidity components are unmeasured — left out of the blend
            rather than scored zero, and never counted against them when those
            filters are switched on. {gammaCoverage.sourceNote}
          </p>
        )}
        {scannedAtEt !== scan.scheduledEt && (
          <p className="mt-1 text-2xs text-flip">
            Scheduled for {scan.scheduledEt} ET. It ran at {scannedAtEt}, so the
            readings below were taken then.
          </p>
        )}
        <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
          The table below always shows the top {SCANNER_TOP_N} by score, however
          many match. Names matching every filter in force come first; the rest
          are shown dimmed, with the filters they missed in red and the number
          that missed beside it. A ranking is an ordering. It is not a
          recommendation, nothing on this page says what to do about any of
          these names, and no row here is a reason to buy or sell anything.
        </p>
      </div>

      <ScannerControls
        settings={settings}
        onChange={setSettings}
        onReset={() => setSettings(DEFAULT_FILTERS)}
        isDefault={isDefault}
        shareUrl={shareUrl}
      />

      <FunnelStrip stages={stages} active={stage} onSelect={setStage} />

      {/* --- the filters, in plain English ---------------------------------- */}
      <section className="panel px-3.5 py-3">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-dim">
          The eight filters you can narrow with
        </h2>
        <ol className="mt-2 space-y-1.5">
          {RULE_KEYS.map((key, i) => (
            <li key={key} className="flex gap-2 text-xs leading-relaxed">
              <span className="shrink-0 tabular-nums text-term-faint">{i + 1}.</span>
              <span>
                <span className="font-bold text-term-text">{RULE_LABEL[key]}</span>
                <span className="text-term-dim"> — {RULE_EXPLANATION[key]}</span>
                {!settings.enabled[key] && (
                  <span className="text-flip"> Switched off.</span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2.5 text-2xs leading-relaxed text-term-faint">
          These decide which rows are marked as matching. They do not decide
          which rows are on the page — the score does that, and the score is a
          separate thing built from the seven components below.
        </p>
      </section>

      {/* --- the seven components, in plain English -------------------------- */}
      <section className="panel px-3.5 py-3">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-dim">
          The seven components the score is built from
        </h2>
        <ol className="mt-2 space-y-1.5">
          {SCORE_KEYS.map((key, i) => (
            <li key={key} className="flex gap-2 text-xs leading-relaxed">
              <span className="shrink-0 tabular-nums text-term-faint">{i + 1}.</span>
              <span>
                <span className="font-bold text-term-text">{SCORE_LABEL[key]}</span>
                <span className="text-term-faint">
                  {' '}
                  ×{SCORE_WEIGHTS[key]}
                </span>
                <span className="text-term-dim"> — {SCORE_EXPLANATION[key]}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2.5 text-2xs leading-relaxed text-term-faint">
          Each is normalised to 0&ndash;100 and they are blended at the weights
          shown, renormalised over whichever of them a name actually has a
          reading for &mdash; an unmeasured component is dropped from the
          blend, never scored zero. Every one of them is a column in the table,
          so the composite can be checked rather than trusted. Open any
          row&rsquo;s detail to see its arithmetic.
        </p>
      </section>

      <section className="scroll-term overflow-x-auto panel">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <caption className="sr-only">
            The top {SCANNER_TOP_N} names by composite score, with each of the
            seven components, all eight filter states, and the readings behind
            them. Sorting a component column reorders these twenty rows; it
            never changes which twenty are here.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={`${HEAD_CLASS} text-right`}>#</th>
              <th scope="col" className={`${HEAD_CLASS} text-left`}>Ticker</th>
              <th scope="col" className={`${HEAD_CLASS} text-right`}>Score</th>
              {SCORE_KEYS.map((key) => (
                <SortableHead
                  key={key}
                  component={key}
                  sort={sort}
                  onSort={setSort}
                />
              ))}
              <th scope="col" className={`${HEAD_CLASS} text-right`}>$/day</th>
              <th scope="col" className={`${HEAD_CLASS} text-left`}>Filters</th>
              <th scope="col" className={`${HEAD_CLASS} text-left`}>What it missed</th>
              <th scope="col" className={HEAD_CLASS}>
                <span className="sr-only">Detail</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ entry, inStage }, i) => (
              <ResultRow
                key={entry.row.symbol}
                scored={entry}
                settings={settings}
                rank={i + 1}
                inStage={inStage}
                nwSettings={nwSettings}
                trendEmaPeriod={trendEmaPeriod}
                contractTopN={contractTopN}
                onGraded={onGraded}
              />
            ))}
          </tbody>
        </table>
      </section>

      {matchingCount === 0 && (
        <p className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-flip/90">
          ! Nothing matches every filter at these settings. That is a real
          answer about the market, and it is why the table above is still full:
          the rows are the twenty highest-scoring names, each with the filter it
          missed marked in red and the reading that missed it printed beside it.
          Read the funnel to see which filter narrowed it to nothing.
        </p>
      )}

      {scan.earningsExcluded.length > 0 && (
        <p className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-term-dim">
          <span className="label-xs mr-1.5">
            Reporting within {DEFAULT_FILTERS.earningsBufferDays} days
          </span>
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
    </div>
  );
}
