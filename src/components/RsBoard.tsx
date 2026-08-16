'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { InfoTip } from './InfoTip';
import { StarButton } from './StarButton';
import { TickerLink } from './TickerLink';
import { formatPrice, formatUsd } from '@/lib/format';
import {
  facetsFor,
  normaliseWeights,
  rankUniverse,
  splitLeadersLaggards,
  toCsv,
  toPlainList,
} from '@/lib/rs/rank';
import type { Gics } from '@/lib/rs/universe';
import {
  DEFAULT_MIN_DOLLAR_VOLUME,
  DEFAULT_WEIGHTS,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  type Confirmation,
  type DigestEntry,
  type RsRow,
  type Trend,
} from '@/lib/rs/types';

/**
 * The whole interactive half of /strength.
 *
 * The server hands down the digest entries — each stock's raw returns and
 * volume figures — and the whole ranking is computed here, including the
 * percentiles. That division is forced by the liquidity floor: changing it
 * changes which stocks are in the percentile pool, so it cannot be applied to
 * an already-ranked list without every remaining rank being wrong. The
 * ranking has to be redone, and redoing it locally over a few hundred entries
 * is instant.
 *
 * It matters beyond feel: this route is force-dynamic, so a router navigation
 * per click would re-read four storage documents each time. Control state is
 * therefore mirrored into the URL with `history.replaceState` — shareable and
 * refresh-proof, but touching nothing except the address bar.
 *
 * This is a client component, so it still server-renders on first load: the
 * HTML contains the full table, not an empty shell.
 */

const TREND_STYLE: Record<Trend, { text: string; mark: string; label: string }> = {
  RISING: { text: 'text-bull', mark: '▲', label: 'Rising' },
  FALLING: { text: 'text-bear', mark: '▼', label: 'Falling' },
  FLAT: { text: 'text-term-faint', mark: '·', label: 'Flat' },
};

/** Percentages, because "3mo 50%" is how the brief and the reader both think. */
const WEIGHT_FIELDS = [
  { key: 'm1' as const, label: '1mo' },
  { key: 'm3' as const, label: '3mo' },
  { key: 'm6' as const, label: '6mo' },
];

const DEFAULT_PERCENTS = {
  m1: Math.round(DEFAULT_WEIGHTS.m1 * 100),
  m3: Math.round(DEFAULT_WEIGHTS.m3 * 100),
  m6: Math.round(DEFAULT_WEIGHTS.m6 * 100),
};

/**
 * Liquidity floors offered.
 *
 * "Any" is included because excluding it would hide the filter's own effect —
 * a reader should be able to see what the floor is actually removing rather
 * than take it on trust.
 */
const LIQUIDITY_CHIPS = [
  { value: 0, label: 'Any' },
  { value: 5_000_000, label: '$5M' },
  { value: DEFAULT_MIN_DOLLAR_VOLUME, label: '$10M' },
  { value: 50_000_000, label: '$50M' },
  { value: 200_000_000, label: '$200M' },
];

const CONFIRMATION_STYLE: Record<Confirmation, { text: string; label: string }> = {
  confirmed: { text: 'text-bull', label: 'CONF' },
  unconfirmed: { text: 'text-flip', label: 'UNCONF' },
};

function scoreTone(score: number): string {
  if (score >= 80) return 'text-bull';
  if (score >= 60) return 'text-term-text';
  if (score <= 20) return 'text-bear';
  if (score <= 40) return 'text-flip';
  return 'text-term-dim';
}

/**
 * Colour for the RSI column.
 *
 * Amber above 70 and green below 30 — a caution and an all-clear, not a
 * direction. Worth being explicit about, because green normally means "up" on
 * this page and here it marks a stock that has been falling hard enough to
 * look stretched. Everything between is left dim: two-thirds of the index sits
 * there on any given day, and colouring it would drown the two ends.
 *
 * Takes the *rounded* value, the one actually printed. Toning the raw number
 * put a cell reading exactly 70 in the neutral grey because it was really
 * 69.6, which reads as a bug rather than as a boundary.
 */
function rsiTone(rsi: number): string {
  if (rsi >= RSI_OVERBOUGHT) return 'text-flip';
  if (rsi <= RSI_OVERSOLD) return 'text-bull';
  return 'text-term-dim';
}

const pctText = (v: number | null, dp = 1): string =>
  v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

// --- pieces -------------------------------------------------------------------

function TrendBadge({ row }: { row: RsRow }) {
  const tone = TREND_STYLE[row.trend];
  return (
    <span className={`inline-flex items-center gap-1 ${tone.text}`}>
      <span aria-hidden>{tone.mark}</span>
      <span className="sr-only">{tone.label}</span>
      {row.delta === null ? '—' : `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(1)}`}
    </span>
  );
}

function ConfirmBadge({ row, compact = false }: { row: RsRow; compact?: boolean }) {
  if (!row.confirmation) {
    return <span className="text-term-faint">—</span>;
  }
  const tone = CONFIRMATION_STYLE[row.confirmation];
  const ratio = row.volumeRatio;

  return (
    <span
      className={`inline-flex items-center gap-1 ${tone.text}`}
      title={
        ratio === null
          ? undefined
          : `Recent volume is ${ratio.toFixed(2)}x its prior three-month average`
      }
    >
      {/*
        The label itself opens the explanation. A `title` attribute alone was
        hover-only, so on a phone — where most people meet CONF/UNCONF for the
        first time — there was no way to find out what it meant.
      */}
      <InfoTip for="rsVolume" className={compact ? 'text-[0.5625rem]' : 'text-2xs'}>
        {tone.label}
      </InfoTip>
      {!compact && ratio !== null && (
        <span className="text-term-faint">{ratio.toFixed(2)}x</span>
      )}
    </span>
  );
}

function Tile({ row, tone }: { row: RsRow; tone: 'bull' | 'bear' }) {
  const edge = tone === 'bull' ? 'border-l-bull/60' : 'border-l-bear/60';
  const accent = tone === 'bull' ? 'text-bull' : 'text-bear';

  return (
    <div className={`panel border-l-2 ${edge} px-3 py-2.5`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 text-sm font-bold tracking-[0.1em] text-term-text">
          <StarButton symbol={row.symbol} size="sm" />
          <TickerLink symbol={row.symbol} />
        </span>
        <span className={`text-lg font-bold tabular-nums leading-none ${accent}`}>
          {Math.round(row.score)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-2xs tabular-nums">
        <span className="text-term-dim">{formatPrice(row.close)}</span>
        <span className={(row.changePct ?? 0) >= 0 ? 'text-bull' : 'text-bear'}>
          {pctText(row.changePct, 2)}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-2xs tabular-nums">
        <span className="text-term-faint">#{row.rank}</span>
        <TrendBadge row={row} />
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-2xs tabular-nums">
        <span className="text-term-faint">{formatUsd(row.avgDollarVolume)}/d</span>
        <ConfirmBadge row={row} compact />
      </div>
    </div>
  );
}

function Tiles({
  title,
  tip,
  subtitle,
  rows,
  tone,
}: {
  title: string;
  tip: 'rsLeaders' | 'rsLaggards';
  subtitle: string;
  rows: RsRow[];
  tone: 'bull' | 'bear';
}) {
  if (rows.length === 0) return null;
  const accent = tone === 'bull' ? 'text-bull' : 'text-bear';

  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          className={`flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.18em] ${accent}`}
        >
          {title}
          <InfoTip for={tip} />
        </h2>
        <p className="text-2xs text-term-faint">{subtitle}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((row) => (
          <Tile key={row.symbol} row={row} tone={tone} />
        ))}
      </div>
    </section>
  );
}

// --- board --------------------------------------------------------------------

export function RsBoard({
  entries,
  sectors,
  signals,
  asOfDate,
}: {
  entries: DigestEntry[];
  sectors: Record<string, Gics>;
  signals: Record<string, { score: number; bullish: number; total: number }>;
  asOfDate: string;
}) {
  const initial = useSearchParams();

  const [facetId, setFacetId] = useState(() => initial.get('group') ?? 'all');
  // Shown by default, so the URL now carries the *hidden* case. `signal=1`
  // from an older shared link still reads as shown, which is what it meant.
  const [showSignal, setShowSignal] = useState(() => initial.get('signal') !== '0');
  /*
   * Hidden by default, unlike the nine-signal column. RSI answers a question
   * nobody arrives at this page asking — the point of /strength is the market
   * comparison — and a twelfth column earns its place only once someone goes
   * looking for it.
   */
  const [showRsi, setShowRsi] = useState(() => initial.get('rsi') === '1');
  const [minVolume, setMinVolume] = useState(() => {
    const raw = initial.get('minVol');
    return raw === null ? DEFAULT_MIN_DOLLAR_VOLUME : Math.max(0, Number(raw) || 0);
  });
  const [confirmedOnly, setConfirmedOnly] = useState(() => initial.get('conf') === '1');
  const [percents, setPercents] = useState(() => ({
    m1: Number(initial.get('w1') ?? DEFAULT_PERCENTS.m1) || 0,
    m3: Number(initial.get('w3') ?? DEFAULT_PERCENTS.m3) || 0,
    m6: Number(initial.get('w6') ?? DEFAULT_PERCENTS.m6) || 0,
  }));
  const [copied, setCopied] = useState<'list' | 'csv' | null>(null);
  /*
   * The blend sits behind "Advanced", collapsed.
   *
   * 20/50/30 is the answer for almost everyone, and three number boxes at the
   * top of the controls invited retuning the weights before reading a single
   * score. A link that arrives carrying non-default weights opens the panel,
   * so a shared URL never hides the one setting that makes it different.
   */
  const [advanced, setAdvanced] = useState(
    () =>
      initial.get('w1') !== null ||
      initial.get('w3') !== null ||
      initial.get('w6') !== null,
  );

  const weights = useMemo(() => normaliseWeights(percents), [percents]);

  /*
   * The full ranking, across the whole liquid index — before any group or
   * confirmation filtering. This ordering is what the rank numbers refer to,
   * so it has to happen first; filtering afterwards shows a subset of names
   * still carrying the ranks they earned against the entire index.
   *
   * The liquidity floor is the exception, and is passed *into* the ranking
   * rather than applied after: a name below the floor is excluded from the
   * comparison itself, not merely hidden.
   */
  const ranked = useMemo(
    () =>
      rankUniverse(entries, weights, {
        sectors,
        signals,
        minDollarVolume: minVolume,
      }),
    [entries, weights, sectors, signals, minVolume],
  );

  const excluded = entries.length - ranked.length;
  const facets = useMemo(() => facetsFor(ranked), [ranked]);

  const active = facets.find((f) => f.id === facetId) ?? facets[0];

  const visible = useMemo(() => {
    const wanted = active?.symbols ? new Set(active.symbols) : null;
    return ranked.filter((r) => {
      if (wanted && !wanted.has(r.symbol)) return false;
      // "Unknown" is not "unconfirmed", so a name whose volume history is too
      // short is filtered out here rather than being shown as if it passed.
      if (confirmedOnly && r.confirmation !== 'confirmed') return false;
      return true;
    });
  }, [ranked, active, confirmedOnly]);

  const { leaders, laggards } = useMemo(
    () => splitLeadersLaggards(visible, 10),
    [visible],
  );

  // Mirror to the address bar. No navigation, so no server round-trip.
  useEffect(() => {
    const merged = new URLSearchParams(window.location.search);
    const write = (key: string, value: string | null) => {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    };
    write('group', facetId === 'all' ? null : facetId);
    write('signal', showSignal ? null : '0');
    write('rsi', showRsi ? '1' : null);
    write('conf', confirmedOnly ? '1' : null);
    write('minVol', minVolume === DEFAULT_MIN_DOLLAR_VOLUME ? null : String(minVolume));
    write('w1', percents.m1 === DEFAULT_PERCENTS.m1 ? null : String(percents.m1));
    write('w3', percents.m3 === DEFAULT_PERCENTS.m3 ? null : String(percents.m3));
    write('w6', percents.m6 === DEFAULT_PERCENTS.m6 ? null : String(percents.m6));

    const query = merged.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, [facetId, showSignal, showRsi, confirmedOnly, minVolume, percents]);

  const copy = async (text: string, which: 'list' | 'csv') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard is blocked on insecure origins and by some permission
      // policies. Fail quietly rather than throwing at the reader.
      setCopied(null);
    }
  };

  const download = () => {
    const blob = new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gammadesk-rs-${facetId}-${asOfDate || 'latest'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const weightsChanged =
    percents.m1 !== DEFAULT_PERCENTS.m1 ||
    percents.m3 !== DEFAULT_PERCENTS.m3 ||
    percents.m6 !== DEFAULT_PERCENTS.m6;

  const chip = (on: boolean) =>
    `border px-2.5 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] transition-colors ${
      on
        ? 'border-pos/60 bg-pos/15 text-pos'
        : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
    }`;

  /*
   * The RSI toggle wears amber rather than the green every other control uses,
   * matching the colour the column itself is about. One control in a different
   * accent is the cheapest way to signal that it adds a different kind of
   * reading rather than filtering the same one.
   */
  const amberChip = (on: boolean) =>
    `border px-2.5 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] transition-colors ${
      on
        ? 'border-flip/60 bg-flip/15 text-flip'
        : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
    }`;

  const button =
    'border border-term-line bg-term-panel/60 px-3 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text';

  const head =
    'sticky top-0 z-10 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';
  const cell = 'border-b border-term-line/60 px-2.5 py-1.5';

  return (
    <div className="space-y-4">
      {/* --- controls --- */}
      <section aria-label="Controls" className="panel space-y-3 px-3.5 py-3">
        <div>
          <span className="label-xs block">View</span>
          <div
            role="group"
            aria-label="Group or sector"
            className="mt-1 flex flex-wrap gap-1"
          >
            {facets.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={f.id === active?.id}
                onClick={() => setFacetId(f.id)}
                className={chip(f.id === active?.id)}
              >
                {f.label}
                <span className="ml-1 font-normal opacity-70">{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div>
            <span className="label-xs flex items-center gap-1.5">
              Min liquidity
              <InfoTip for="rsLiquidity" />
            </span>
            <div
              role="group"
              aria-label="Minimum average daily dollar volume"
              className="mt-1 flex flex-wrap gap-1"
            >
              {LIQUIDITY_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  aria-pressed={minVolume === c.value}
                  onClick={() => setMinVolume(c.value)}
                  className={chip(minVolume === c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label-xs flex items-center gap-1.5">
              Volume confirmed
              <InfoTip for="rsVolume" />
            </span>
            <button
              type="button"
              aria-pressed={confirmedOnly}
              onClick={() => setConfirmedOnly((v) => !v)}
              className={`mt-1 ${chip(confirmedOnly)}`}
            >
              {confirmedOnly ? 'Only confirmed' : 'All'}
            </button>
          </div>

          <div>
            <span className="label-xs flex items-center gap-1.5">
              Nine-signal score
              <InfoTip for="rsSignalScore" />
            </span>
            <button
              type="button"
              aria-pressed={showSignal}
              onClick={() => setShowSignal((v) => !v)}
              className={`mt-1 ${chip(showSignal)}`}
            >
              {showSignal ? 'Shown' : 'Hidden'}
            </button>
          </div>

          <div>
            <span className="label-xs flex items-center gap-1.5">
              RSI (14)
              <InfoTip for="rsRsi" />
            </span>
            <button
              type="button"
              aria-pressed={showRsi}
              onClick={() => setShowRsi((v) => !v)}
              className={`mt-1 ${amberChip(showRsi)}`}
            >
              {showRsi ? 'Shown' : 'Hidden'}
            </button>
          </div>
        </div>

        <div className="border-t border-term-line/70 pt-3">
          <button
            type="button"
            aria-expanded={advanced}
            aria-controls="rs-advanced"
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-term-faint transition-colors hover:text-term-dim"
          >
            <span aria-hidden>{advanced ? '▾' : '▸'}</span>
            Advanced
            {weightsChanged && (
              <span className="font-normal normal-case tracking-normal text-flip">
                blend changed from {DEFAULT_PERCENTS.m1}/{DEFAULT_PERCENTS.m3}/
                {DEFAULT_PERCENTS.m6}
              </span>
            )}
          </button>

          {advanced && (
            <div id="rs-advanced" className="mt-2.5">
              <span className="label-xs flex items-center gap-1.5">
                Blend weights
                <InfoTip for="rsWindows" />
              </span>
              <div className="mt-1 flex flex-wrap items-end gap-2">
                {WEIGHT_FIELDS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
                      {f.label}
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={percents[f.key]}
                        onChange={(e) =>
                          setPercents((p) => ({
                            ...p,
                            [f.key]: Math.max(
                              0,
                              Math.min(100, Number(e.target.value) || 0),
                            ),
                          }))
                        }
                        className="w-16 border border-term-edge bg-term-panel px-2 py-1 text-xs tabular-nums text-term-text focus:border-pos/60 focus:outline-none focus:ring-1 focus:ring-pos/40"
                      />
                      <span className="text-2xs text-term-faint">%</span>
                    </span>
                  </label>
                ))}
              </div>
              {/*
                The three do not have to add to 100 — they are renormalised — but
                a reader who typed 30/30/30 deserves to be told what that actually
                became rather than left wondering whether it was ignored.
              */}
              <p className="mt-1.5 text-2xs text-term-faint">
                Used as {Math.round(weights.m1 * 100)} / {Math.round(weights.m3 * 100)} /{' '}
                {Math.round(weights.m6 * 100)} after scaling to 100%. Default is{' '}
                {DEFAULT_PERCENTS.m1} / {DEFAULT_PERCENTS.m3} / {DEFAULT_PERCENTS.m6}.{' '}
                {/*
                  Always rendered, not only once the weights differ: a reader who
                  has been typing needs to see the way back before deciding to
                  experiment, not after.
                */}
                <button
                  type="button"
                  onClick={() => setPercents({ ...DEFAULT_PERCENTS })}
                  disabled={!weightsChanged}
                  className="underline decoration-dotted underline-offset-2 transition-colors enabled:text-flip enabled:hover:text-term-text disabled:cursor-default disabled:no-underline disabled:opacity-40"
                >
                  Reset to default
                </button>
              </p>
            </div>
          )}
        </div>

        {excluded > 0 && (
          <p className="text-2xs text-term-faint">
            <span className="text-flip">{excluded}</span> of {entries.length} names
            trade under {formatUsd(minVolume)} a day and are excluded from the
            ranking, so they cannot take a percentile place from a name you could
            actually trade.
          </p>
        )}
      </section>

      {visible.length === 0 ? (
        <div className="panel px-4 py-10 text-center text-xs text-term-dim">
          <p className="text-term-text">Nothing to show for these filters.</p>
          <p className="mx-auto mt-2 max-w-md leading-relaxed">
            None of the {ranked.length} ranked names match {active?.label}
            {confirmedOnly && ' with volume confirmation'}. Try a lower liquidity
            floor{confirmedOnly && ', or allow unconfirmed names'}.
          </p>
        </div>
      ) : (
        <>
          <Tiles
            title="Leaders"
            tip="rsLeaders"
            subtitle={`strongest ${leaders.length} of ${visible.length}`}
            rows={leaders}
            tone="bull"
          />
          <Tiles
            title="Laggards"
            tip="rsLaggards"
            subtitle={`weakest ${laggards.length}, worst first`}
            rows={laggards}
            tone="bear"
          />

          {/* --- full table --- */}
          <section aria-label="Full ranking" className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-term-line px-3.5 py-2">
              <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
                {active?.kind === 'all'
                  ? `All ${visible.length}, ranked`
                  : `${active?.label} — ${visible.length}, ranked`}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => copy(toPlainList(visible), 'list')}
                  className={button}
                >
                  {copied === 'list' ? 'Copied' : 'Copy list'}
                </button>
                <button
                  type="button"
                  onClick={() => copy(toCsv(visible), 'csv')}
                  className={button}
                >
                  {copied === 'csv' ? 'Copied' : 'Copy CSV'}
                </button>
                <button type="button" onClick={download} className={button}>
                  Export CSV
                </button>
              </div>
            </div>

            <div className="scroll-term max-h-[70vh] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
                <caption className="sr-only">
                  S&amp;P 500 constituents ranked by relative strength, strongest
                  first.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={head}>
                      #
                    </th>
                    <th scope="col" className={`${head} text-left`}>
                      Ticker
                    </th>
                    <th scope="col" className={head}>
                      <span className="inline-flex items-center justify-end gap-1">
                        RS
                        <InfoTip for="rsScore" />
                      </span>
                    </th>
                    <th scope="col" className={head}>
                      <span className="inline-flex items-center justify-end gap-1">
                        1w
                        <InfoTip for="rsTrend" />
                      </span>
                    </th>
                    <th scope="col" className={head}>
                      <span className="inline-flex items-center justify-end gap-1">
                        1mo
                        <InfoTip for="rsWindows" />
                      </span>
                    </th>
                    <th scope="col" className={head}>
                      3mo
                    </th>
                    <th scope="col" className={head}>
                      6mo
                    </th>
                    <th scope="col" className={head}>
                      Price
                    </th>
                    {/*
                      Today's change. It had no header at all, which shifted
                      every column to its right off its own heading — the
                      nine-signal column was printing CONF/UNCONF under "9-sig".
                    */}
                    <th scope="col" className={head}>
                      1d
                    </th>
                    <th scope="col" className={head}>
                      $ Vol/d
                    </th>
                    <th scope="col" className={head}>
                      <span className="inline-flex items-center justify-end gap-1">
                        Volume
                        <InfoTip for="rsVolume" />
                      </span>
                    </th>
                    {showRsi && (
                      <th scope="col" className={head}>
                        <span className="inline-flex items-center justify-end gap-1">
                          RSI
                          <InfoTip for="rsRsi" />
                        </span>
                      </th>
                    )}
                    {showSignal && (
                      <th scope="col" className={head}>
                        <span className="inline-flex items-center justify-end gap-1">
                          9-sig
                          <InfoTip for="rsSignalScore" />
                        </span>
                      </th>
                    )}
                    <th scope="col" className={`${head} text-left`}>
                      Sector
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.symbol}>
                      <td className={`${cell} text-term-faint`}>{r.rank}</td>
                      <th
                        scope="row"
                        className={`${cell} text-left font-bold text-term-text`}
                      >
                        <span className="flex items-center gap-1">
                          <StarButton symbol={r.symbol} size="sm" />
                          <TickerLink symbol={r.symbol} />
                        </span>
                      </th>
                      <td className={`${cell} font-bold ${scoreTone(r.score)}`}>
                        {Math.round(r.score)}
                      </td>
                      <td className={cell}>
                        <TrendBadge row={r} />
                      </td>

                      {(['m1', 'm3', 'm6'] as const).map((key) => (
                        <td key={key} className={cell}>
                          <span className="text-term-text">
                            {r.percentiles[key] === null
                              ? '—'
                              : Math.round(r.percentiles[key] as number)}
                          </span>
                          <span className="ml-1.5 text-2xs text-term-faint">
                            {pctText(r.returns[key], 0)}
                          </span>
                        </td>
                      ))}

                      <td className={`${cell} text-term-dim`}>{formatPrice(r.close)}</td>
                      <td
                        className={`${cell} ${
                          (r.changePct ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                        }`}
                      >
                        {pctText(r.changePct, 2)}
                      </td>

                      <td className={`${cell} text-term-faint`}>
                        {formatUsd(r.avgDollarVolume)}
                      </td>
                      <td className={cell}>
                        <ConfirmBadge row={r} />
                      </td>

                      {showRsi && (
                        <td className={cell}>
                          {r.rsi === null ? (
                            <span className="text-term-faint">—</span>
                          ) : (
                            <span className={rsiTone(Math.round(r.rsi))}>
                              {Math.round(r.rsi)}
                            </span>
                          )}
                        </td>
                      )}

                      {showSignal && (
                        <td className={`${cell} text-term-dim`}>
                          {r.signal ? r.signal.score : '—'}
                        </td>
                      )}

                      <td className={`${cell} text-left text-2xs text-term-faint`}>
                        {[r.sectorName, ...r.groups].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
