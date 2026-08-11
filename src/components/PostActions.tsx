'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Copy and Post-to-X for the morning post.
 *
 * The text is passed in rather than read from the DOM, so what gets copied is
 * exactly the string the server built — no risk of picking up rendered
 * whitespace or a soft-wrapped line.
 */
export function PostActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing on unmount only; the flag itself is set from the click handler.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be refused (insecure context, or denied). Fall
      // back to a selection the user can copy with the keyboard.
      const area = document.createElement('textarea');
      area.value = text;
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

  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={copy}
        aria-live="polite"
        className="flex-1 border border-pos/60 bg-pos/15 px-6 py-4 text-sm font-bold uppercase tracking-[0.18em] text-pos transition-colors hover:bg-pos/25 sm:flex-none"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>

      <a
        href={intent}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 border border-term-edge bg-term-raised px-6 py-4 text-center text-sm font-bold uppercase tracking-[0.18em] text-term-text transition-colors hover:border-pos/60 hover:text-pos sm:flex-none"
      >
        Post to X ↗
      </a>
    </div>
  );
}
