'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SymbolSearch } from './SymbolSearch';
import { formatPrice } from '@/lib/format';
import { strengthDots } from '@/lib/groups/ranking';
import type { QuickScoreResult } from '@/lib/ticker/quickScore';
import { isValidSymbol, MAX_WATCHLIST, useWatchlist } from '@/lib/watchlist/storage';

function Dots({ bullish, total }: { bullish: number; total: number }) {
  const filled = strengthDots(bullish, total);
  const on = filled === 3 ? 'bg-bull' : filled === 2 ? 'bg-flip' : 'bg-bear';
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Strength ${filled} of 3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= filled ? on : 'bg-term-line'}`} />
      ))}
    </span>
  );
}

export function WatchlistView() {
  const { symbols, ready, remove, clear, toggle, full } = useWatchlist();

  /*
   * One piece of state, tagged with the symbol list it belongs to. Loading and
   * staleness are then derived rather than tracked separately, which keeps the
   * effect free of any synchronous setState — it only writes from the async
   * callbacks, which is what effects are for.
   */
  const [loaded, setLoaded] = useState<{
    key: string;
    results: QuickScoreResult[] | null;
    error: string | null;
  } | null>(null);

  const key = symbols.join(',');

  useEffect(() => {
    if (!ready || symbols.length === 0) return;

    const controller = new AbortController();

    fetch(`/api/watchlist?symbols=${encodeURIComponent(key)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { results: QuickScoreResult[] }) =>
        setLoaded({ key, results: body.results, error: null }),
      )
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setLoaded({ key, results: null, error: 'Could not load scores. Try again in a moment.' });
      });

    return () => controller.abort();
  }, [key, ready, symbols.length]);

  const fresh = loaded?.key === key ? loaded : null;
  const results = fresh?.results ?? null;
  const error = fresh?.error ?? null;
  const loading = ready && symbols.length > 0 && fresh === null;

  // Keep the stored order, and carry failures through so a bad symbol is
  // visible rather than silently missing.
  const bySymbol = new Map((results ?? []).map((r) => [r.symbol, r]));
  const rows = symbols.map((s) => bySymbol.get(s) ?? null);

  const scored = (results ?? []).filter((r): r is Extract<QuickScoreResult, { ok: true }> => r.ok);
  const bullishCount = scored.filter((r) => r.vote === 'bullish').length;

  const button =
    'border border-term-line bg-term-panel/60 px-3 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text disabled:opacity-40';

  if (!ready) {
    return <div className="panel h-40 animate-pulse" />;
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-end justify-between gap-3 px-3.5 py-3">
        <SymbolSearch
          inputId="watch-add"
          label="Add a ticker"
          placeholder="ADD TICKER"
          submitLabel="Add"
          size="sm"
          validate={isValidSymbol}
          clearOnSubmit
          disabled={full}
          onSubmit={toggle}
        />

        <div className="flex items-center gap-3">
          {scored.length > 0 && (
            <span className="text-2xs text-term-faint">
              <span className="text-bull">{bullishCount}</span> of {scored.length} leaning
              bullish
            </span>
          )}
          <button
            type="button"
            onClick={clear}
            disabled={symbols.length === 0}
            className={button}
          >
            Clear all
          </button>
        </div>
      </div>

      {symbols.length === 0 ? (
        <div className="panel px-4 py-10 text-center text-xs text-term-dim">
          <p className="text-term-text">Nothing starred yet.</p>
          <p className="mx-auto mt-2 max-w-lg leading-relaxed">
            Star a ticker from{' '}
            <Link href="/ticker" className="text-term-dim underline decoration-dotted">
              /ticker
            </Link>{' '}
            or{' '}
            <Link href="/strength" className="text-term-dim underline decoration-dotted">
              /strength
            </Link>
            , or add one above. The list is stored in this browser only — there
            is no account, and nothing is sent anywhere until scores are
            fetched.
          </p>
        </div>
      ) : (
        <section className="panel">
          <div className="flex items-center justify-between border-b border-term-line px-3.5 py-2">
            <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
              {symbols.length} starred
              {symbols.length >= MAX_WATCHLIST && (
                <span className="ml-2 font-normal text-flip">list full</span>
              )}
            </h2>
            {loading && <span className="text-2xs text-term-faint">loading…</span>}
          </div>

          {error && (
            <p className="border-b border-term-line px-3.5 py-2 text-2xs text-bear">{error}</p>
          )}

          <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
            <caption className="sr-only">Your starred tickers and their scores.</caption>
            <thead>
              <tr>
                {['Ticker', 'Score', 'Strength', 'Price', 'Chg', '20d', ''].map((h, i) => (
                  <th
                    key={h || 'actions'}
                    scope="col"
                    className={`border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim ${
                      i === 0 || i === 2 ? 'text-left' : ''
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const symbol = symbols[i];
                if (!row) {
                  return (
                    <tr key={symbol} className="border-t border-term-line/60">
                      <th scope="row" className="px-2.5 py-1.5 text-left font-bold text-term-text">
                        {symbol}
                      </th>
                      <td colSpan={6} className="px-2.5 py-1.5 text-left text-2xs text-term-faint">
                        {loading ? 'loading…' : 'no data'}
                      </td>
                    </tr>
                  );
                }
                if (!row.ok) {
                  return (
                    <tr key={symbol} className="border-t border-term-line/60">
                      <th scope="row" className="px-2.5 py-1.5 text-left font-bold text-term-faint">
                        {symbol}
                      </th>
                      <td colSpan={5} className="px-2.5 py-1.5 text-left text-2xs text-flip/80">
                        {row.reason}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={() => remove(symbol)}
                          aria-label={`Remove ${symbol}`}
                          className="text-term-faint transition-colors hover:text-bear"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                }

                const score = Math.round((row.bullish / row.total) * 100);
                return (
                  <tr key={symbol} className="border-t border-term-line/60">
                    <th scope="row" className="px-2.5 py-1.5 text-left font-bold">
                      <Link
                        href={`/ticker?symbol=${encodeURIComponent(symbol)}`}
                        className="text-term-text underline decoration-dotted underline-offset-2 hover:text-pos"
                      >
                        {symbol}
                      </Link>
                    </th>
                    <td
                      className={`px-2.5 py-1.5 font-bold ${
                        score >= 70 ? 'text-bull' : score <= 35 ? 'text-bear' : 'text-term-dim'
                      }`}
                    >
                      {score}
                    </td>
                    <td className="px-2.5 py-1.5 text-left">
                      <Dots bullish={row.bullish} total={row.total} />
                      <span className="ml-2 text-2xs text-term-faint">
                        {row.bullish}/{row.total}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-term-dim">{formatPrice(row.price)}</td>
                    <td className={`px-2.5 py-1.5 ${row.changePct >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {row.changePct >= 0 ? '+' : ''}
                      {(row.changePct * 100).toFixed(2)}%
                    </td>
                    <td className={`px-2.5 py-1.5 ${row.momentum20 >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {row.momentum20 >= 0 ? '+' : ''}
                      {(row.momentum20 * 100).toFixed(1)}%
                    </td>
                    <td className="px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => remove(symbol)}
                        aria-label={`Remove ${symbol} from watchlist`}
                        className="text-term-faint transition-colors hover:text-bear"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
