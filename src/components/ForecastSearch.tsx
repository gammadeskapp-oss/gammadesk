'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SymbolSearch } from './SymbolSearch';

const SUGGESTIONS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'IWM'];

export function ForecastSearch({ initial = '' }: { initial?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <SymbolSearch
      inputId="forecast-ticker"
      label="Ticker symbol"
      placeholder="SIMULATE ANY TICKER — SPY, APPLE, NVIDIA…"
      submitLabel="Simulate"
      pendingLabel="Simulating…"
      pending={pending}
      initial={initial}
      suggestions={SUGGESTIONS}
      onSubmit={(symbol) =>
        startTransition(() =>
          router.push(`/forecast?symbol=${encodeURIComponent(symbol)}`),
        )
      }
    />
  );
}
