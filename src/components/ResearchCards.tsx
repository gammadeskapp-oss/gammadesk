'use client';

import Link from 'next/link';
import { RESEARCH_CARDS } from '@/lib/frontDoor';

/**
 * The "Continue your research" grid.
 *
 * Rendered twice from one list — at the bottom of the front door, and inside
 * the mobile menu, where it stands in for the persistent nav bar a phone does
 * not have room for. See `lib/frontDoor.ts` for why the labels are questions.
 *
 * A client component only because the drawer variant needs to close the drawer
 * on click; the list itself is static.
 */
export function ResearchCards({
  variant = 'grid',
  onNavigate,
  heading = 'Continue your research',
}: {
  /** `grid` on the page; `list` in the narrow mobile drawer. */
  variant?: 'grid' | 'list';
  /** Called after a card is followed — the drawer closes itself with this. */
  onNavigate?: () => void;
  heading?: string;
}) {
  const grid = variant === 'grid';

  return (
    <section aria-label={heading} className={grid ? 'space-y-3' : 'space-y-2'}>
      <h2
        className={`font-bold uppercase tracking-[0.18em] ${
          grid ? 'text-xs text-term-text' : 'px-2.5 text-2xs text-term-faint'
        }`}
      >
        {heading}
      </h2>

      <div
        className={
          grid
            ? 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            : 'flex flex-col gap-1.5 px-2'
        }
      >
        {RESEARCH_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            onClick={onNavigate}
            /*
              The whole card is the target, not just the label. On a phone a
              two-line card is a comfortable tap; a link the width of its own
              text is not.
            */
            className={`group flex flex-col justify-between border border-term-line bg-term-panel/60 transition-colors hover:border-pos/50 hover:bg-pos/[0.06] ${
              grid ? 'min-h-[5.5rem] gap-2 p-3.5' : 'gap-1 p-2.5'
            }`}
          >
            <span
              className={`font-bold tracking-[0.1em] text-term-text transition-colors group-hover:text-pos ${
                grid ? 'text-sm' : 'text-xs'
              }`}
            >
              {card.label}
            </span>
            <span
              className={`leading-relaxed text-term-dim ${
                grid ? 'text-xs' : 'text-2xs'
              }`}
            >
              {card.question}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
