'use client';

import type { ReactNode } from 'react';
import type { Facet } from '@/lib/rs/rank';

/**
 * The group / sector filter chips, shared by /strength and /velocity.
 *
 * Lifted out of `RsBoard` rather than copied, so the two pages cannot drift
 * into looking like two different controls that do the same job. `RsBoard`
 * keeps its sector colouring by passing `toneFor`; /velocity has no sector
 * momentum reading to colour with and passes nothing, which is the only
 * difference between the two.
 *
 * The chip style itself is the one every filter control on the site already
 * uses, unchanged.
 */

export function chipClass(on: boolean): string {
  return `border px-2.5 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] transition-colors ${
    on
      ? 'border-pos/60 bg-pos/15 text-pos'
      : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
  }`;
}

export function FacetChips({
  facets,
  activeId,
  onChange,
  label = 'Group or sector',
  toneFor,
}: {
  facets: Facet[];
  activeId: string;
  onChange: (id: string) => void;
  /** Accessible name for the group of buttons. */
  label?: string;
  /**
   * Optional per-facet text colour, for the sector momentum reading on
   * /strength. Only the facet's name is tinted — the chip's border and fill
   * already say which one is selected, and tinting the whole box would leave
   * those two facts fighting over one control.
   */
  toneFor?: (facet: Facet) => string | null;
}) {
  return (
    <div role="group" aria-label={label} className="mt-1 flex flex-wrap gap-1">
      {facets.map((f) => {
        const tone = toneFor?.(f) ?? null;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={f.id === activeId}
            onClick={() => onChange(f.id)}
            className={chipClass(f.id === activeId)}
          >
            <span className={tone ?? ''}>{f.label as ReactNode}</span>
            <span className="ml-1 font-normal opacity-70">{f.count}</span>
          </button>
        );
      })}
    </div>
  );
}
