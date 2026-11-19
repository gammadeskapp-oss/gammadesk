'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FLOW_LEAN, flowLeanLabel, HEADLINE_MAX_DTE, NEAR_MONEY_PCT, THIN_EXPIRY_SHARE, WIDE_MAX_DTE, WIDE_STRIKE_PCT, type FlowLean } from '@/lib/tasty/flow';
import type { LiveFlowReading } from '@/lib/tasty/flowReading';
import { LiveAsOf } from './LiveAsOf';

/**
 * SPY put/call FLOW on `/lab`, off the Tastytrade dxLink stream.
 *
 * Polls `/api/lab/flow` every 5 s (paused while the tab is hidden) instead of
 * riding the page's 15 s server re-render, so the number ticks with the tape.
 * A failed poll or a `down` reading puts a red banner up at once; the last
 * good numbers stay on screen greyed out under it, stamped with their time,
 * and are never shown as current.
 */

const POLL_MS = 5_000;
const FETCH_TIMEOUT_MS = 20_000;

function ratioText(r: number | null): string {
  return r === null ? '—' : r.toFixed(2);
}

function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function leanClass(lean: FlowLean | null): string {
  if (lean === 'bullish') return 'text-bull';
  if (lean === 'bearish') return 'text-bear';
  if (lean === 'neutral') return 'text-term-text';
  return 'text-term-faint';
}

function clockEt(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function FlowPanel() {
  const [reading, setReading] = useState<LiveFlowReading | null>(null);
  const [lastGood, setLastGood] = useState<LiveFlowReading | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    inFlight.current = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch('/api/lab/flow', { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status === 401 ? 'Lab session expired — log in again.' : `Flow endpoint answered ${res.status}.`);
      const next = (await res.json()) as LiveFlowReading;
      setReading(next);
      setFetchError(null);
      if (next.status === 'ok') setLastGood(next);
    } catch (e) {
      setFetchError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Flow request timed out.');
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const id = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  const isDown = Boolean(fetchError) || reading?.status === 'down';
  // What to draw numbers from: the current reading when it is good, else the last good one (greyed).
  const shown = reading?.status === 'ok' && !fetchError ? reading : lastGood;
  const stale = isDown && shown !== null;
  const near = shown?.result?.near ?? null;
  const wide = shown?.result?.wide ?? null;
  const wideReady = shown?.ready.wide ?? false;

  return (
    <section
      className="panel space-y-2.5 px-3.5 py-3 text-xs"
      data-testid="lab-flow"
      data-status={isDown ? 'down' : (reading?.status ?? 'pending')}
      data-delta-ratio={near?.live.deltaRatio ?? ''}
      data-volume-ratio={near?.live.volumeRatio ?? ''}
      data-computed-at={shown?.computedAtMs ?? ''}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="label-xs text-term-text">{reading?.symbol ?? 'SPY'} put/call flow</h2>
        <span className="text-2xs text-term-faint">
          {reading?.mode === 'mock' ? (
            <span className="font-bold text-flip">MOCK — not live</span>
          ) : (
            (reading?.sourceLabel ?? 'Tastytrade dxLink')
          )}
          {' · '}polls every {POLL_MS / 1000}s
        </span>
        <span className="ml-auto text-2xs">
          {shown ? (
            <>
              <LiveAsOf asOfMs={shown.asOfMs} label={shown.asOfLabel} delayMs={shown.delayed ? shown.delayMs : null} />
              <span className="ml-2 text-term-faint">computed {clockEt(shown.computedAtMs)} ET</span>
            </>
          ) : (
            <span className="text-term-faint">{reading ? '' : 'reading the feed…'}</span>
          )}
        </span>
      </header>

      {isDown && (
        <div role="alert" data-testid="lab-flow-down" className="border-2 border-bear bg-bear/10 px-3 py-2 text-bear">
          <p className="text-sm font-bold uppercase tracking-[0.14em]">Live flow feed down — not live</p>
          <p className="mt-1 text-term-dim">
            {fetchError ?? reading?.error ?? 'The dxLink stream returned nothing usable.'}{' '}
            {stale && shown
              ? `The numbers below are the last good reading, from ${clockEt(shown.computedAtMs)} ET, greyed out — they are not current.`
              : 'No flow numbers are shown until the stream is back.'}{' '}
            Retrying every {POLL_MS / 1000}s.
          </p>
        </div>
      )}

      {!isDown && reading?.delayed && (
        <div role="alert" className="border-2 border-flip bg-flip/10 px-3 py-2 text-flip">
          <p className="font-bold uppercase tracking-[0.14em]">
            Flow is delayed{reading.delayMs !== null ? ` ~${Math.round(reading.delayMs / 60_000)} min` : ''} — not live
          </p>
          <p className="mt-1 text-term-dim">
            The Tastytrade stream is on a delayed data level (<code>{reading.feedLevel ?? 'unknown'}</code>), so every
            trade below is that old.
          </p>
        </div>
      )}

      {!isDown && reading?.status === 'loading' && (
        <div className="border border-term-line bg-term-raised/40 px-3 py-2 text-term-dim" data-testid="lab-flow-loading">
          <p className="font-bold text-term-text">Subscribing {reading.symbol}&rsquo;s option chain…</p>
          <p className="mt-1">
            Near the money: {reading.coverage.near.have.toLocaleString('en-US')} of{' '}
            {reading.coverage.near.total.toLocaleString('en-US')} contracts in · wide chain{' '}
            {reading.coverage.wide.have.toLocaleString('en-US')} of {reading.coverage.wide.total.toLocaleString('en-US')}.
            dxLink limits how fast symbols can be added
            {reading.coverage.queued > 0 ? `; about ${Math.ceil(reading.coverage.queued / 150)} s left` : ''}. No ratio is
            printed off a partial chain.
          </p>
        </div>
      )}

      {shown && near && (
        <div className={stale ? 'opacity-40 grayscale' : ''} data-testid="lab-flow-numbers">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            {/* Headline: since watching began, each contract at its at-trade delta */}
            <div className="border border-term-line px-3 py-2.5">
              <p className="label-xs">Delta-weighted put/call · near the money</p>
              <div className="mt-1 flex items-baseline gap-3">
                <span
                  className={`text-4xl font-bold tabular-nums ${leanClass(near.live.deltaLean)}`}
                  data-testid="lab-flow-headline"
                >
                  {ratioText(near.live.deltaRatio)}
                </span>
                <span className={`text-sm font-bold uppercase tracking-[0.12em] ${leanClass(near.live.deltaLean)}`}>
                  {flowLeanLabel(near.live.deltaLean)}
                </span>
              </div>
              <p className="mt-1 text-2xs text-term-dim">
                Trades since {near.live.sinceMs ? `${clockEt(near.live.sinceMs)} ET` : '—'}, each at its delta when it
                traded
                {near.live.note ? (
                  <span className="text-term-faint"> · {near.live.note}</span>
                ) : (
                  <span className="text-term-faint">
                    {' '}
                    · puts {compact(near.live.putDeltaVolume)} vs calls {compact(near.live.callDeltaVolume)} delta-contracts
                    · same window by count {ratioText(near.live.volumeRatio)}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-2xs text-term-faint">
                Strikes {shown.result!.band.low.toFixed(0)}–{shown.result!.band.high.toFixed(0)} (±{NEAR_MONEY_PCT * 100}% of{' '}
                {shown.spot?.toFixed(2)}) · {near.expirations.length} expirations ≤{HEADLINE_MAX_DTE}d
              </p>
              <p className="mt-1.5 text-2xs text-term-dim">
                Wide chain (±{WIDE_STRIKE_PCT * 100}%, ≤{WIDE_MAX_DTE}d), same window:{' '}
                {wideReady && wide ? (
                  <span className={`font-bold tabular-nums ${leanClass(wide.live.deltaLean)}`}>
                    {ratioText(wide.live.deltaRatio)} ({flowLeanLabel(wide.live.deltaLean)})
                  </span>
                ) : (
                  <span className="text-term-faint">
                    loading ({shown.coverage.wide.have.toLocaleString('en-US')} of{' '}
                    {shown.coverage.wide.total.toLocaleString('en-US')} contracts)
                  </span>
                )}
              </p>
              <p className="mt-1 text-2xs text-term-faint" data-testid="lab-flow-session">
                Whole session incl. earlier trades:{' '}
                <span className="tabular-nums text-term-dim">{ratioText(near.session.deltaRatio)}</span>
                {near.session.lateShare > 0.005 &&
                  ` — ${Math.round(near.session.lateShare * 100)}% of it traded before this server was watching and is weighted at today’s current delta, which overstates contracts that have moved into the money since.`}
              </p>
            </div>

            {/* Reference ratios */}
            <div className="space-y-2">
              <div className="border border-term-line px-3 py-2">
                <p className="label-xs">Traditional ratio · put vol ÷ call vol · whole session</p>
                <p className="mt-0.5 text-2xs text-term-dim">
                  Near the money{' '}
                  <span
                    className={`text-base font-bold tabular-nums ${leanClass(near.session.volumeLean)}`}
                    data-testid="lab-flow-volume"
                  >
                    {ratioText(near.session.volumeRatio)}
                  </span>{' '}
                  <span className="text-term-faint">
                    ({compact(near.session.putVolume)} puts / {compact(near.session.callVolume)} calls)
                  </span>
                </p>
                <p className="text-2xs text-term-dim">
                  Wide chain{' '}
                  {wideReady && wide ? (
                    <span className={`font-bold tabular-nums ${leanClass(wide.session.volumeLean)}`}>
                      {ratioText(wide.session.volumeRatio)}
                    </span>
                  ) : (
                    <span className="text-term-faint">loading</span>
                  )}
                </p>
              </div>
              <div className="border border-dashed border-term-line px-3 py-2" data-testid="lab-flow-oi">
                <p className="label-xs">
                  Open interest put/call · <span className="text-flip">prior session settled — not live</span>
                </p>
                <p className="mt-0.5 text-2xs text-term-dim">
                  Near the money <span className="font-bold tabular-nums text-term-text">{ratioText(near.oiRatio)}</span>
                  {' · '}wide chain{' '}
                  {wideReady && wide ? (
                    <span className="font-bold tabular-nums text-term-text">{ratioText(wide.oiRatio)}</span>
                  ) : (
                    <span className="text-term-faint">loading</span>
                  )}
                  <span className="text-term-faint"> — OI settles overnight and does not move during the session.</span>
                </p>
              </div>
            </div>
          </div>

          <ExcludedLine reading={shown} />
          <MethodNotes marketOpen={shown.marketOpen} />
        </div>
      )}

      <p className="text-2xs leading-relaxed text-term-faint">
        <span className="text-term-dim">How to read it.</span> Lean: ≤{FLOW_LEAN.bullishMax.toFixed(1)} bullish lean ·{' '}
        {FLOW_LEAN.bullishMax.toFixed(1)}–{FLOW_LEAN.bearishMin.toFixed(1)} neutral · ≥{FLOW_LEAN.bearishMin.toFixed(1)}{' '}
        bearish lean, the same cut for every ratio here. The headline weights each contract by its |delta|, so bigger
        directional bets count more than cheap far-out-of-the-money tickets. It still can&rsquo;t tell a bought put from
        a sold put — that needs trade-side data, which is not built yet — so it is a sentiment read, not a prediction,
        and a crowded hedge can squeeze the other way. Never a buy or sell signal.
      </p>
    </section>
  );
}

function ExcludedLine({ reading }: { reading: LiveFlowReading }) {
  const ex = reading.result?.excluded ?? [];
  if (ex.length === 0) return null;
  const far = ex.filter((e) => e.reason === 'far-dated');
  const thin = ex.filter((e) => e.reason === 'thin');
  return (
    <details className="mt-2 text-2xs text-term-faint">
      <summary className="cursor-pointer">
        Left out of the headline: {far.length} far-dated expiration{far.length === 1 ? '' : 's'} (&gt;{HEADLINE_MAX_DTE}d)
        {thin.length > 0 && `, ${thin.length} thin (<${THIN_EXPIRY_SHARE * 100}% of near-money volume)`} — still in the
        wide-chain numbers.
      </summary>
      <ul className="mt-1 columns-2 gap-4 sm:columns-4">
        {ex.map((e) => (
          <li key={e.expiration} className="tabular-nums">
            {e.expiration} · {e.dte}d · {compact(e.volume)} ctr · {e.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

function MethodNotes({ marketOpen }: { marketOpen: boolean }) {
  return (
    <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
      {!marketOpen && <span className="font-bold text-term-dim">Market closed — this is the session&rsquo;s tally. </span>}
      Volume is each option&rsquo;s day volume from dxLink Trade events; each new batch of contracts is weighted by the
      delta the feed held for that option when it printed (Greeks events). The headline window starts when this server
      began watching the chain, because trades from before then have no at-trade delta. OI from Summary events. The
      secondary scope is a wide chain, not the full one: SPY lists ~12k contracts and dxLink caps one connection near 25k
      subscriptions, which the gamma books share.
    </p>
  );
}
