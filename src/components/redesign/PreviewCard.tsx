import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A Home teaser card: real data inside, plus an explicit "Open full view"
 * action to the detail page. Each Home card is a teaser, never the full tool —
 * this replaces the old "Continue your research" text links with visual
 * previews that show live figures.
 *
 * `linksInside` matters for the same reason it does on the old dashboard: when
 * the body carries its own links (per-ticker rows), the whole card cannot be a
 * single anchor, so the header action carries the link instead.
 */
export function PreviewCard({
  title,
  href,
  openLabel = 'Open full view',
  tone = 'neutral',
  linksInside = false,
  children,
}: {
  title: string;
  href: string;
  openLabel?: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'bull' | 'bear' | 'flip';
  linksInside?: boolean;
  children: ReactNode;
}) {
  const edge = {
    neutral: 'border-l-term-line',
    pos: 'border-l-pos/60',
    neg: 'border-l-neg/60',
    bull: 'border-l-bull/60',
    bear: 'border-l-bear/60',
    flip: 'border-l-flip/60',
  }[tone];

  const shell = `panel group flex h-full flex-col border-l-2 ${edge} p-4 transition-colors`;

  const header = (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="label-xs">{title}</h3>
      {linksInside ? (
        <Link
          href={href}
          className="text-2xs text-term-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-pos"
        >
          {openLabel} →
        </Link>
      ) : (
        <span className="text-2xs text-term-faint transition-colors group-hover:text-pos">
          {openLabel} →
        </span>
      )}
    </div>
  );

  if (linksInside) {
    return (
      <section className={shell}>
        {header}
        <div className="mt-2 flex-1">{children}</div>
      </section>
    );
  }

  return (
    <Link href={href} className={`${shell} hover:bg-term-raised/60`}>
      {header}
      <div className="mt-2 flex-1">{children}</div>
    </Link>
  );
}
