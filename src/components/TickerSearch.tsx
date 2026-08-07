'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

const SUGGESTIONS = ['AAPL', 'NVDA', 'TSLA', 'SPY', 'MSFT', 'AMD'];

export function TickerSearch({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const go = (symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    startTransition(() => router.push(`/ticker?symbol=${encodeURIComponent(clean)}`));
  };

  return (
    <div className="space-y-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor="ticker-input" className="sr-only">
          Ticker symbol
        </label>
        <input
          id="ticker-input"
          name="symbol"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="ENTER TICKER — AAPL, NVDA, TSLA…"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={10}
          className="min-w-0 flex-1 border border-term-edge bg-term-panel px-3.5 py-2.5 text-sm tracking-[0.14em] text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none focus:ring-1 focus:ring-pos/40"
        />
        <button
          type="submit"
          disabled={pending || value.trim().length === 0}
          className="border border-pos/50 bg-pos/10 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-pos transition-colors hover:bg-pos/20 disabled:opacity-40"
        >
          {pending ? 'Loading…' : 'Analyse'}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label-xs mr-1">Try</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setValue(s);
              go(s);
            }}
            className="border border-term-line px-2 py-1 text-2xs tracking-[0.12em] text-term-faint transition-colors hover:border-term-edge hover:text-term-dim"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
