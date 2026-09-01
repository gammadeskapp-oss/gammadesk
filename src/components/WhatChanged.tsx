/**
 * What moved since the previous session.
 *
 * Renders nothing at all when there is nothing to report — no heading, no
 * "no changes today", no dashes. An empty state here would be a claim about
 * the data ("we compared, and nothing moved") that the caller cannot always
 * back: most of the time an empty list means a snapshot was missing, not that
 * the market stood still. Saying nothing is the only honest option.
 *
 * The lines themselves are built in `lib/whatChanged`, which is where the
 * rules about declines and missing snapshots live.
 */
export function WhatChanged({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby="what-changed" className="panel px-4 py-3">
      <h2
        id="what-changed"
        className="label-xs"
      >
        What changed since the previous session
      </h2>
      <ul className="mt-2 space-y-1">
        {lines.map((line) => (
          <li
            key={line}
            className="flex gap-2 text-xs leading-relaxed text-term-text"
          >
            {/*
              A neutral marker, deliberately. A tone-coded bullet — green for
              the improvements, red for the declines — would turn a list of
              facts into a scoreboard, and a reader would start skimming for
              the colour instead of reading the line.
            */}
            <span aria-hidden className="text-term-faint">
              ·
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
