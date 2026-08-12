'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

/**
 * Switches between the plain-English view and the full data.
 *
 * Simple is the default, and the choice is remembered — someone who has
 * deliberately gone to Advanced should not be dropped back to the beginner
 * view on every page load, or on the next page.
 *
 * The preference is read through an external store rather than seeded into
 * state, so the server renders Simple, the browser re-renders with whatever
 * was stored, and hydration stays consistent. Only the chosen branch is
 * mounted: rendering both and hiding one would start two chart instances.
 */

export type Mode = 'simple' | 'advanced';

const KEY = 'gammadesk.readmode';
const EVENT = 'gammadesk:readmode';

function readMode(): Mode {
  try {
    return window.localStorage.getItem(KEY) === 'advanced' ? 'advanced' : 'simple';
  } catch {
    return 'simple';
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function writeMode(mode: Mode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Storage can be unavailable; the event still syncs this session.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * The current mode, for chrome that sits outside the toggle.
 *
 * The page heading needs it: "Dealer Positioning" is the first thing on the
 * screen and it is jargon, which rather undercuts a beginner-first default.
 */
export function useReadMode(): Mode {
  return useSyncExternalStore(subscribe, readMode, () => 'simple' as Mode);
}

export function ReadMode({
  simple,
  advanced,
  /** Wording for the reveal button, which differs a little per page. */
  revealLabel = 'Show the data behind this',
}: {
  simple: ReactNode;
  advanced: ReactNode;
  revealLabel?: string;
}) {
  const mode = useSyncExternalStore(subscribe, readMode, () => 'simple' as Mode);
  const advancedOn = mode === 'advanced';

  return (
    <div className="space-y-4">
      {advancedOn ? advanced : simple}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => writeMode(advancedOn ? 'simple' : 'advanced')}
          aria-expanded={advancedOn}
          className={`border px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] transition-colors ${
            advancedOn
              ? 'border-term-line bg-term-panel/60 text-term-dim hover:border-term-edge hover:text-term-text'
              : 'border-pos/60 bg-pos/10 text-pos hover:bg-pos/20'
          }`}
        >
          {advancedOn ? '← Back to the simple view' : `${revealLabel} →`}
        </button>

        <span className="text-2xs text-term-faint">
          {advancedOn
            ? 'Advanced view. Your choice is remembered.'
            : 'Simple view — the numbers and tables are one tap away.'}
        </span>
      </div>
    </div>
  );
}
