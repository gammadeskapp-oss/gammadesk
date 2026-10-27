'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SymbolSearch } from './SymbolSearch';
import { tickerHref } from './TickerLink';

const SUGGESTIONS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA'];

export function DecisionSearch({
  initial = '',
  basePath,
  params,
}: {
  initial?: string;
  /** Navigate here instead of the public ticker link; `/lab` passes its own path. */
  basePath?: string;
  /** Query parameters kept alongside `ticker`, e.g. `{ tab: 'ticker' }`. */
  params?: Record<string, string>;
}) {
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
      // Same helper the links use, so the search box and every ticker in the
      // app cannot end up pointing at different URLs.
      onSubmit={(symbol) =>
        startTransition(() =>
          router.push(
            basePath
              ? `${basePath}?${new URLSearchParams({ ...params, ticker: symbol.trim().toUpperCase() }).toString()}`
              : tickerHref(symbol),
          ),
        )
      }
    />
  );
}
