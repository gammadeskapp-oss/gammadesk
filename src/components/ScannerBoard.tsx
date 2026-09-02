'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScannerChart } from '@/components/ScannerChart';
import { ScannerControls } from '@/components/ScannerControls';
import { TickerLink } from '@/components/TickerLink';
import { formatUsd } from '@/lib/format';
import { buildWatchLine, whyItRanks } from '@/lib/scanner/evaluate';
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
  MARKET_REGIME_NOTE,
  SCORE_WEIGHTS,
  scoreAndJudge,
  type FilterSettings,
  type FunnelStage,
  type ScoredRow,
} from '@/lib/scanner/score';
import {
  OPTION_BADGE_LABEL,
  RULE_EXPLANATION,
  RULE_KEYS,
  RULE_LABEL,
  RULE_SHORT,
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
 * One rule's state on one row.
 *
 * The reading travels with the colour, in the `title` and in the screen-reader
 * text, because a red chip labelled `VOL` is a colour a reader has to take on
 * trust. A disabled rule keeps its chip and loses its colour: switching a rule
 * off must not be able to delete the number it was measuring.
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
      title={`${RULE_LABEL[rule]}: ${detail}${enabled ? '' : ' (rule switched off)'}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-0.5 text-2xs font-bold tracking-[0.06em] ${
        enabled ? STATE_CLASS[state] : 'border-term-line/60 text-term-faint/70'
      }`}
    >
      {RULE_SHORT[rule]}
      <span aria-hidden>{STATE_GLYPH[state]}</span>
      <span className="sr-only">
        {RULE_LABEL[rule]} {state}: {detail}
        {enabled ? '' : ' — this rule is switched off'}
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
        arithmetic by eye. Click one to see exactly which names reached it —
        including, at the last stage, none of them.
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

// --- one row -----------------------------------------------------------------

function num(value: number | null, digits = 0, suffix = ''): string {
  return value === null ? '—' : `${value.toFixed(digits)}${suffix}`;
}

function ResultRow({
  scored,
  settings,
  rank,
  nwSettings,
  trendEmaPeriod,
  contractTopN,
  onGraded,
}: {
  scored: ScoredRow;
  settings: FilterSettings;
  rank: number;
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

  const { row, verdicts, score, passes, failingLabel, earningsExcluded } = scored;
  const m = row.metrics;

  /*
   * Dimmed, not hidden. A row that failed something is still the row the
   * ranking put here, and the reader has to be able to see both facts at once
   * — which is exactly what the old page could not do, because a failing name
   * simply was not on it.
   */
  const dimmed = !passes || earningsExcluded;

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
      <tr className={dimmed ? 'opacity-60' : undefined}>
        <td className="border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums text-term-faint">
          {rank}
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
        <td className="border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums text-term-dim">
          {m.rsScore.toFixed(0)}
        </td>
        <td className="border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums text-term-dim">
          {num(m.pctAbove200, 0, '%')}
        </td>
        <td className="border-b border-term-line/60 px-2 py-2 text-right align-top tabular-nums text-term-dim">
          {num(m.volumeRatio, 2, 'x')}
        </td>
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
          ) : passes ? (
            <span className="text-bull">Passes every rule in force.</span>
          ) : (
            failingLabel
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
        The watch line, on its own row under every result and never behind the
        Detail toggle. A result rendered with nothing to watch reads as a
        result with nothing to watch, and that is a claim.
      */}
      <tr className={dimmed ? 'opacity-60' : undefined}>
        <td />
        <td colSpan={8} className="border-b border-term-line/60 px-2 pb-2 text-2xs leading-relaxed text-flip">
          <span className="font-bold tracking-[0.06em]">Watch: </span>
          {watch}
        </td>
      </tr>

      {open && (
        <tr>
          <td />
          <td colSpan={8} className="border-b border-term-line px-2 pb-4 pt-1">
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
                {(Object.keys(SCORE_WEIGHTS) as Array<keyof typeof SCORE_WEIGHTS>)
                  .map((key) => {
                    const value = score.components[key];
                    return `${key} ${
                      value === null ? 'not measured' : value.toFixed(0)
                    } × ${SCORE_WEIGHTS[key]}`;
                  })
                  .join(' · ')}
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

  const judged = useMemo(() => scoreAndJudge(rows, settings), [rows, settings]);
  const stages = useMemo(() => buildFunnel(judged, settings), [judged, settings]);

  const onGraded = useCallback(
    (symbol: string, quality: OptionQuality) =>
      setGraded((current) => ({ ...current, [symbol]: quality })),
    [],
  );

  const regime = scan.spyRegime ?? 'unknown';
  const marketBlocks = settings.requireCalmMarket && regime !== 'positive';

  /*
   * ## What ends up on screen, and why it is always full
   *
   * Names clearing every rule in force come first, in score order. The table
   * is then padded to `contractTopN` with the next-highest scorers, dimmed and
   * carrying their red badges.
   *
   * Both halves matter. Without the first, moving a slider would not visibly
   * re-partition anything — the score does not depend on the cutoffs, so the
   * top of the raw ranking barely moves. Without the second, a morning where
   * nothing passes renders an empty table again, which is the whole failure
   * being fixed.
   *
   * `contractTopN` is the length for a reason beyond neatness: it is exactly
   * how many names had a chain pulled, so every row on screen has had all five
   * of its rules actually tested rather than five with the last one grey.
   */
  const { shown, passingCount } = useMemo(() => {
    const stageEntry = stages.find((s) => s.key === stage);
    const allowed = stageEntry ? new Set(stageEntry.symbols) : null;

    /*
     * The calm-market toggle is deliberately not applied here. When it is on
     * and the market is not calm it replaces the whole table with a statement
     * saying so — an empty table under a full funnel would look like a bug,
     * and the reader needs to know their own toggle is what hid the list.
     */
    const filtered = allowed
      ? judged.filter((entry) => allowed.has(entry.row.symbol))
      : judged;

    const passing = filtered.filter(
      (entry) => entry.passes && !entry.earningsExcluded,
    );
    const passingSymbols = new Set(passing.map((entry) => entry.row.symbol));
    const rest = filtered.filter(
      (entry) => !passingSymbols.has(entry.row.symbol),
    );

    return {
      shown: [...passing, ...rest].slice(0, contractTopN),
      passingCount: passing.length,
    };
  }, [judged, stages, stage, contractTopN]);

  const isDefault = settingsAreDefault(settings);
  const shareUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}${window.location.pathname}${
          paramsFromSettings(settings) ? `?${paramsFromSettings(settings)}` : ''
        }`;

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
          One market-wide condition, stated once. It is not one of the five
          rules and it removes no name from the list below — it used to, and
          because it is identical for every stock in the index, that alone
          could empty this page on any volatile morning. The toggle in the
          controls restores that behaviour if you want it.
        </p>
      </div>

      <div className="panel px-3.5 py-3">
        <p className="text-xs text-term-text">
          <span className="font-bold">
            Scanned at {scannedAtEt} ET · {scan.scored} names scored ·{' '}
            {passingCount} pass every rule in force
          </span>{' '}
          <span className="text-term-dim">· {gammaStamp}</span>
        </p>
        {scannedAtEt !== scan.scheduledEt && (
          <p className="mt-1 text-2xs text-flip">
            Scheduled for {scan.scheduledEt} ET. It ran at {scannedAtEt}, so the
            readings below were taken then.
          </p>
        )}
        <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
          The table below always shows the top {contractTopN} by score, however
          many pass. Names that pass every rule in force come first; the rest
          are shown dimmed, with the rules they failed in red and the number
          that failed them beside it. A ranking is an ordering. It is not a
          recommendation, and nothing on this page says what to do about any of
          these names.
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

      {/* --- the five rules, in plain English ------------------------------- */}
      <section className="panel px-3.5 py-3">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-dim">
          The five rules, and what each is worth in the score
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
          The score is a weighted blend of the five, renormalised over whichever
          of them a name actually has a reading for — an unmeasured component is
          dropped from the blend, never scored zero. Open any row&rsquo;s detail
          to see its arithmetic.
        </p>
      </section>

      {marketBlocks ? (
        <div className="panel border-l-2 border-l-bear/60 px-4 py-8 text-center text-xs">
          <p className="font-bold text-bear">
            Hidden: you have asked to see names only when the wider market is
            calm, and it is not.
          </p>
          <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
            {MARKET_REGIME_NOTE[regime]} {scan.scored} names were scored and{' '}
            {passingCount} pass every rule in force — the list is there, this
            toggle is hiding it. Switch &ldquo;only show names when the wider
            market is calm&rdquo; off in the controls above to see it.
          </p>
        </div>
      ) : (
        <section className="scroll-term overflow-x-auto panel">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <caption className="sr-only">
              The top {contractTopN} names by composite score, with all five
              rule states and the readings behind them.
            </caption>
            <thead>
              <tr>
                <th scope="col" className={`${HEAD_CLASS} text-right`}>#</th>
                <th scope="col" className={`${HEAD_CLASS} text-left`}>Ticker</th>
                <th scope="col" className={`${HEAD_CLASS} text-right`}>Score</th>
                <th scope="col" className={`${HEAD_CLASS} text-right`}>RS</th>
                <th scope="col" className={`${HEAD_CLASS} text-right`}>vs 200D</th>
                <th scope="col" className={`${HEAD_CLASS} text-right`}>Vol</th>
                <th scope="col" className={`${HEAD_CLASS} text-right`}>$/day</th>
                <th scope="col" className={`${HEAD_CLASS} text-left`}>Rules</th>
                <th scope="col" className={`${HEAD_CLASS} text-left`}>What stopped it</th>
                <th scope="col" className={HEAD_CLASS}>
                  <span className="sr-only">Detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry, i) => (
                <ResultRow
                  key={entry.row.symbol}
                  scored={entry}
                  settings={settings}
                  rank={i + 1}
                  nwSettings={nwSettings}
                  trendEmaPeriod={trendEmaPeriod}
                  contractTopN={contractTopN}
                  onGraded={onGraded}
                />
              ))}
            </tbody>
          </table>

          {shown.length === 0 && (
            <p className="border-t border-term-line px-3.5 py-6 text-center text-2xs text-term-faint">
              No names reached the funnel stage you selected. Clear it above to
              see the full ranking — the stage count and this empty table are
              the same fact stated twice.
            </p>
          )}
        </section>
      )}

      {passingCount === 0 && !marketBlocks && (
        <p className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-flip/90">
          ! Nothing clears every rule at these settings. That is a real answer
          about the market, and it is why the table above is still full: the
          rows are the closest things to passing, ranked, each with the rule it
          failed marked in red. Read the funnel to see which step ate the list.
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
