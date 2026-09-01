'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SymbolSearch } from './SymbolSearch';

const SUGGESTIONS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA', 'MSFT'];

/**
 * Symbol entry for the analogues page.
 *
 * Its own component rather than `TickerSearch` because that one navigates to
 * /ticker, and because the suggestions here are deliberately different: the
 * index ETFs have thirty years of history behind them and a recent listing has
 * a few, which is the first thing this page has to be honest about.
 */
export function AnalogueSearch({
  initial = '',
  condition,
}: {
  initial?: string;
  /** Kept across a symbol change, so the reader stays on the same condition. */
  condition?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <SymbolSearch
      inputId="analogue-input"
      label="Ticker symbol"
      placeholder="ENTER TICKER — SPY, QQQ, AAPL…"
      submitLabel="Look up"
      pendingLabel="Reading history…"
      pending={pending}
      initial={initial}
      suggestions={SUGGESTIONS}
      onSubmit={(symbol) => {
        const params = new URLSearchParams({ symbol });
        if (condition) params.set('condition', condition);
        startTransition(() => router.push(`/analogues?${params}`));
      }}
    />
  );
}
