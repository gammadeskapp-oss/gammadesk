'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SymbolSearch } from './SymbolSearch';

const SUGGESTIONS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'];

export function DecisionSearch({ initial = '' }: { initial?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <SymbolSearch
      inputId="decision-ticker"
      label="Ticker symbol"
      placeholder="ANY TICKER — SPY, APPLE, NVIDIA…"
      submitLabel="Read it"
      pendingLabel="Reading…"
      pending={pending}
      initial={initial}
      suggestions={SUGGESTIONS}
      onSubmit={(symbol) =>
        startTransition(() =>
          router.push(`/decision?symbol=${encodeURIComponent(symbol)}`),
        )
      }
    />
  );
}
