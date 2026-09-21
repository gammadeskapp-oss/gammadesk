'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Copy for TradingView" — copies today's GammaDesk Levels code so a reader can
 * paste it straight into the GammaDesk Levels Pine indicator on TradingView.
 *
 * The code is built on the server (`buildLevelCode`) and passed in, so what is
 * copied is exactly the string the indicator expects — no DOM scraping. Mirrors
 * the clipboard-with-fallback behaviour of the morning-post copy button, since
 * clipboard access is refused in insecure contexts and some in-app browsers.
 */
export function CopyTradingViewButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const area = document.createElement('textarea');
      area.value = code;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
      } finally {
        area.remove();
      }
    }

    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 border-t border-term-line pt-4">
      <button
        type="button"
        onClick={copy}
        aria-live="polite"
        className="flex w-full items-center justify-center gap-2 rounded border border-term-line px-3 py-2.5 text-2xs font-bold uppercase tracking-[0.16em] text-term-dim transition-colors hover:border-pos/50 hover:text-term-text"
      >
        {copied ? '✓ Copied' : 'Copy for TradingView'}
      </button>
      <p className="mt-2 text-center text-2xs text-term-faint">
        Paste into the free “GammaDesk Levels” indicator on TradingView.
      </p>
    </div>
  );
}
