/**
 * The provenance line that sits at the bottom of one data card.
 *
 * ## Why every card and not just every page
 *
 * A page-level "data as of" stamp is correct only while a page has one clock.
 * Most do not: the dashboard puts a chain snapshot from twenty minutes ago
 * next to a sector ranking computed after last night's close next to a flow
 * scan from the session before that. One stamp in the header describes at most
 * one of them and quietly vouches for the rest.
 *
 * So the stamp travels with the number it describes. That is more repetition
 * on screen than a single header line, and the repetition is the point — a
 * card whose figure is a day older than its neighbour should be visibly a day
 * older than its neighbour.
 *
 * ## Why never hidden
 *
 * This used to live inside the methodology drawer on several surfaces, which
 * meant the reader had to already suspect something before they could find out
 * when the data was from. Provenance that only the suspicious can reach is not
 * provenance.
 */
export function AsOfStamp({
  label,
  /** Overrides the leading word, e.g. `computed`, `run`, `close`. */
  prefix = 'as of',
  /**
   * What is missing, for the no-timestamp case, e.g. `This chain`.
   *
   * A card with no timestamp still shows a line. "We do not know when this is
   * from" is a worse answer than a date and a much better one than a blank
   * space where the date would have been.
   */
  subject = 'This reading',
  className = '',
}: {
  label: string | null | undefined;
  prefix?: string;
  subject?: string;
  className?: string;
}) {
  return (
    <p className={`mt-2 text-2xs leading-relaxed text-term-faint ${className}`}>
      {label ? (
        <>
          {prefix} <span className="tabular-nums">{label}</span>
        </>
      ) : (
        `${subject} carries no timestamp, so its age cannot be shown.`
      )}
    </p>
  );
}
