import Link from 'next/link';
import type { Methodology } from '@/lib/methodology';

/**
 * "How this is calculated", collapsed by default, under a block of levels.
 *
 * Built on `<details>` rather than React state so it needs no JavaScript and
 * can render inside a server component. That matters more than it sounds: this
 * is the element a sceptical reader opens, and it should be there whether or
 * not the bundle arrived.
 *
 * Collapsed by default is a deliberate call, not a hedge. Expanded, eight rows
 * of provenance would push the levels themselves off a phone screen, and the
 * reader who wants the numbers would learn to scroll past the caveats — which
 * is how caveats stop being read at all. The summary line names what is inside
 * so the choice to open it is informed.
 */
export function MethodologyDrawer({
  methodology,
  /** Anchor on /guide's methodology section this drawer corresponds to. */
  anchor,
}: {
  methodology: Methodology;
  anchor: string;
}) {
  const { title, facts, assumption, caveat, notes } = methodology;

  return (
    <details className="panel group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-pos transition-transform group-open:rotate-90">
          &#9656;
        </span>
        <span className="font-bold uppercase tracking-[0.14em] text-pos">
          {title}
        </span>
        <span className="text-term-faint">
          inputs, timestamps, and the assumption underneath
        </span>
      </summary>

      <div className="border-t border-term-line px-3.5 py-3">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="label-xs">{fact.label}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-term-text">
                {fact.value}
              </dd>
              {fact.note && (
                <dd className="mt-0.5 text-2xs leading-relaxed text-term-faint">
                  {fact.note}
                </dd>
              )}
            </div>
          ))}
        </dl>

        <div className="mt-3 border-t border-term-line pt-3">
          <h4 className="label-xs">The assumption underneath</h4>
          <p className="mt-1 text-2xs leading-relaxed text-term-dim">{assumption}</p>
        </div>

        {caveat && (
          <p className="mt-2 border-l-2 border-l-flip/60 bg-flip/[0.06] px-3 py-2 text-2xs leading-relaxed text-flip">
            {caveat}
          </p>
        )}

        {notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-2xs leading-relaxed text-flip/80">
            {notes.map((note) => (
              <li key={note}>! {note}</li>
            ))}
          </ul>
        )}

        <p className="mt-3 border-t border-term-line pt-3 text-2xs text-term-faint">
          <Link
            href={`/guide#${anchor}`}
            className="underline hover:text-term-text"
          >
            Every calculation on the site, in one place
          </Link>
        </p>
      </div>
    </details>
  );
}
