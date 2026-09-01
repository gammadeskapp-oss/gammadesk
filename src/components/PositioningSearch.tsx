'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SymbolSearch } from './SymbolSearch';

/**
 * Ticker box for the positioning page.
 *
 * Same component and same behaviour as the forecast's box; only the wording and
 * the destination differ. The suggestions lead with the two index ETFs on
 * purpose — they are the symbols this page's dealer-sign assumption actually
 * describes, and the single names below them are the ones that come with the
 * caveat.
 */
const SUGGESTIONS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'AMD'];

export function PositioningSearch({ initial = '' }: { initial?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <SymbolSearch
      inputId="positioning-ticker"
      label="Ticker symbol"
      /*
        Sentence case, and not the shouted uppercase the other three boxes
        use, because this one sits on the front door and reviewers did not
        recognise it as a ticker search at all. "LOAD CHAIN" named an internal
        operation — the option chain — that a first-time reader has no word
        for; "Check ticker" names what they came to do.
      */
      placeholder="Enter any ticker — SPY, NVDA, TSLA"
      submitLabel="Check ticker"
      plainCase
      pendingLabel="Loading…"
      pending={pending}
      initial={initial}
      suggestions={SUGGESTIONS}
      onSubmit={(symbol) =>
        startTransition(() => router.push(`/?symbol=${encodeURIComponent(symbol)}`))
      }
    />
  );
}
