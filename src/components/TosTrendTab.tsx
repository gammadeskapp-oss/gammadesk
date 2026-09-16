'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPrice } from '@/lib/format';
import type { QuickScoreResult } from '@/lib/ticker/quickScore';
import { TickerLink } from './TickerLink';

/**
 * The owner-only "TOS Trend" tab body on /scanner.
 *
 * Locked by default: it asks `/api/tos/trend` for the list, and a 401 (no valid
 * session cookie) means show the password box and nothing else — no tickers are
 * ever requested, let alone rendered, without a cookie the server accepts. Once
 * unlocked it refreshes the list every 60 seconds and pulls a current price per
 * ticker from the app's shared quote source. Tickers link to /decision, the
 * app's one destination for a symbol's chart and options chain.
 *
 * This mounts only when the TOS tab is the active one, so the S&P 500 tab does
 * no work on its behalf.
 */

const REFRESH_MS = 60_000;
const PRICE_LIMIT = 30; // The quote endpoint caps at 30 symbols.

interface TrendData {
  symbols: string[];
  addedAt: Record<string, string>;
  updatedAt: string | null;
  lastCheckedAt: string | null;
  isStale: boolean;
}

type Status = 'loading' | 'locked' | 'unlocked' | 'error';
type Prices = Map<string, { price: number; changePct: number }>;

function formatClock(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' ET'
  );
}

/** Coarse "added N ago", from a symbol's first-seen time. */
function formatAgo(iso: string | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function TosTrendTab() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<TrendData | null>(null);
  const [prices, setPrices] = useState<Prices>(new Map());
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Lets the interval read the current status without re-arming each render.
  // Written in an effect, not during render — a ref is not render output.
  const statusRef = useRef<Status>('loading');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const loadPrices = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) {
      setPrices(new Map());
      return;
    }
    try {
      const list = symbols.slice(0, PRICE_LIMIT).join(',');
      const res = await fetch(`/api/watchlist?symbols=${encodeURIComponent(list)}`);
      if (!res.ok) return;
      const body: { results: QuickScoreResult[] } = await res.json();
      const next: Prices = new Map();
      for (const r of body.results) {
        if (r.ok) next.set(r.symbol, { price: r.price, changePct: r.changePct });
      }
      setPrices(next);
    } catch {
      // Prices are supplementary — leave dashes rather than blanking the list.
    }
  }, []);

  const loadTrend = useCallback(async () => {
    try {
      const res = await fetch('/api/tos/trend', { cache: 'no-store' });
      if (res.status === 401) {
        setStatus('locked');
        setData(null);
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const body: TrendData = await res.json();
      setData(body);
      setStatus('unlocked');
      void loadPrices(body.symbols);
    } catch {
      setStatus('error');
    }
  }, [loadPrices]);

  useEffect(() => {
    // The initial load runs from a task rather than synchronously in the effect
    // body, so its state updates land in a callback (as the polling ones do)
    // rather than cascading out of render.
    const kick = setTimeout(() => void loadTrend(), 0);
    const timer = setInterval(() => {
      // Keep polling only while unlocked; a locked tab makes no requests.
      if (statusRef.current === 'unlocked') void loadTrend();
    }, REFRESH_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [loadTrend]);

  const submitUnlock = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setUnlockError(null);
      try {
        const res = await fetch('/api/tos/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (res.ok) {
          setPassword('');
          await loadTrend();
        } else if (res.status === 429) {
          setUnlockError('Too many attempts. Try again in a few minutes.');
        } else if (res.status === 503) {
          setUnlockError('This tab is not configured for unlock yet.');
        } else {
          setUnlockError('Wrong password.');
        }
      } catch {
        setUnlockError('Could not reach the server. Try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [password, loadTrend],
  );

  const lock = useCallback(async () => {
    try {
      await fetch('/api/tos/lock', { method: 'POST' });
    } catch {
      // Even if the call fails, drop the client view; the cookie is httpOnly so
      // there is nothing to clear here beyond what the server does.
    }
    setData(null);
    setPrices(new Map());
    setStatus('locked');
  }, []);

  // --- locked / loading / error states ---------------------------------------

  const subtitle = (
    <p className="text-xs leading-relaxed text-term-dim">
      Stocks from my thinkorswim Trend scan, updated about every 5 minutes.
    </p>
  );

  if (status === 'loading') {
    return (
      <div className="space-y-4">
        {subtitle}
        <div className="panel h-40 animate-pulse" />
      </div>
    );
  }

  if (status === 'locked') {
    return (
      <div className="space-y-4">
        {subtitle}
        <section className="panel mx-auto max-w-md px-4 py-8">
          <h2 className="text-center text-xs font-bold uppercase tracking-[0.18em] text-term-text">
            This tab is private
          </h2>
          <p className="mt-2 text-center text-2xs leading-relaxed text-term-faint">
            Enter the password to view the Trend list.
          </p>
          <form onSubmit={submitUnlock} className="mt-4 space-y-3">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              className="w-full border border-term-line bg-term-bg px-3 py-2 text-xs text-term-text outline-none focus:border-pos/60"
            />
            {unlockError && <p className="text-2xs text-bear">{unlockError}</p>}
            <button
              type="submit"
              disabled={submitting || password.length === 0}
              className="w-full border border-pos/60 bg-pos/12 px-3 py-2 text-2xs font-bold uppercase tracking-[0.16em] text-pos transition-colors hover:bg-pos/20 disabled:opacity-40"
            >
              {submitting ? 'Unlocking…' : 'Unlock'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className="space-y-4">
        {subtitle}
        <div className="panel px-4 py-10 text-center text-xs text-term-dim">
          Could not load the Trend list. It will retry on its own.
        </div>
      </div>
    );
  }

  // --- unlocked --------------------------------------------------------------

  const { symbols, addedAt, updatedAt, lastCheckedAt, isStale } = data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {subtitle}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="label-xs">Last updated</div>
            <div className="text-xs tabular-nums text-term-dim">{formatClock(updatedAt)}</div>
          </div>
          <div className="text-right">
            <div className="label-xs">Last checked</div>
            <div className="text-xs tabular-nums text-term-dim">{formatClock(lastCheckedAt)}</div>
          </div>
          <button
            type="button"
            onClick={lock}
            className="border border-term-line bg-term-panel/60 px-3 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text"
          >
            <span aria-hidden className="mr-1">🔒</span>
            Lock
          </button>
        </div>
      </div>

      {isStale && (
        <p className="panel border-l-2 border-l-flip/60 px-3.5 py-2.5 text-2xs leading-relaxed text-flip/90">
          The scanner has not checked email in over 15 minutes, so this list may
          be behind. It updates itself once the check catches up.
        </p>
      )}

      {symbols.length === 0 ? (
        <div className="panel px-4 py-10 text-center text-xs text-term-dim">
          <p className="text-term-text">No stocks in the Trend scan right now.</p>
          <p className="mx-auto mt-2 max-w-lg leading-relaxed text-term-faint">
            Tickers appear here as thinkorswim emails alerts for the Trend scan.
          </p>
        </div>
      ) : (
        <section className="panel">
          <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
            <caption className="sr-only">Tickers on the thinkorswim Trend scan.</caption>
            <thead>
              <tr>
                {['Ticker', 'Price', 'Chg', 'Added'].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim ${
                      i === 0 ? 'text-left' : ''
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map((symbol) => {
                const quote = prices.get(symbol);
                return (
                  <tr key={symbol} className="border-t border-term-line/60">
                    <th scope="row" className="px-2.5 py-1.5 text-left font-bold text-term-text">
                      <TickerLink symbol={symbol} />
                    </th>
                    <td className="px-2.5 py-1.5 text-term-dim">
                      {quote ? formatPrice(quote.price) : '—'}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 ${
                        !quote ? 'text-term-faint' : quote.changePct >= 0 ? 'text-bull' : 'text-bear'
                      }`}
                    >
                      {quote
                        ? `${quote.changePct >= 0 ? '+' : ''}${(quote.changePct * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className="px-2.5 py-1.5 text-term-faint">{formatAgo(addedAt[symbol])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
        <p>
          <span className="text-term-dim">Research only. </span>
          This is the raw output of a thinkorswim scan, shown for context. It is
          not scored or ranked here, and nothing on this tab is a suggestion to
          buy or sell. Prices come from the app&rsquo;s shared quote source and
          are delayed. Click a ticker to open its chart and options chain.
        </p>
      </section>
    </div>
  );
}
