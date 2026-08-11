'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SymbolSearch } from './SymbolSearch';

const SUGGESTIONS = ['AAPL', 'NVDA', 'TSLA', 'SPY', 'MSFT', 'AMD'];

export function TickerSearch({ initial = '' }: { initial?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <SymbolSearch
      inputId="ticker-input"
      label="Ticker symbol"
      placeholder="ENTER TICKER OR COMPANY — AAPL, APPLE, TESLA…"
      submitLabel="Analyse"
      pendingLabel="Loading…"
      pending={pending}
      initial={initial}
      suggestions={SUGGESTIONS}
      onSubmit={(symbol) =>
        startTransition(() =>
          router.push(`/ticker?symbol=${encodeURIComponent(symbol)}`),
        )
      }
    />
  );
}
