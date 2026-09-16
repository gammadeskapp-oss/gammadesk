'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * The two views of /scanner, as tabs beside the title.
 *
 * State lives in the URL — `/scanner` is the S&P 500 scanner, `/scanner?tab=tos`
 * is the owner-only TOS Trend list. Keeping it in the query string means a
 * refresh stays on the same tab and every existing `/scanner` link still opens
 * the S&P 500 view, which is the default.
 *
 * These are links, not buttons, so the server can render the right view on a
 * cold load; the active one is decided from the current query.
 */
export function ScannerTabs() {
  const params = useSearchParams();
  const active = params.get('tab') === 'tos' ? 'tos' : 'sp500';

  const cls = (selected: boolean) =>
    `border px-3 py-1 text-2xs font-bold uppercase tracking-[0.16em] transition-colors ${
      selected
        ? 'border-pos/60 bg-pos/12 text-pos shadow-[inset_0_-2px_0_0_rgba(240,165,0,0.85)]'
        : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
    }`;

  return (
    <div role="tablist" aria-label="Scanner view" className="flex items-center gap-1.5">
      <Link
        href="/scanner"
        role="tab"
        aria-selected={active === 'sp500'}
        aria-current={active === 'sp500' ? 'page' : undefined}
        className={cls(active === 'sp500')}
      >
        S&amp;P 500
      </Link>
      <Link
        href="/scanner?tab=tos"
        role="tab"
        aria-selected={active === 'tos'}
        aria-current={active === 'tos' ? 'page' : undefined}
        className={cls(active === 'tos')}
      >
        <span aria-hidden className="mr-1">🔒</span>
        TOS Trend
      </Link>
    </div>
  );
}
