import Link from 'next/link';

/**
 * Every ticker in the app renders through here.
 *
 * The point is the single edit: the route a symbol points at is decided in one
 * file, so changing the URL scheme is a one-line change rather than a sweep of
 * forty components.
 *
 * Styling is deliberately quiet. Tables here are mostly tickers, and giving
 * each one link colouring turns a positioning table into a wall of blue. It
 * reads as body text and reveals itself on hover, focus, or a long press.
 */

/** The one place the destination is decided. */
export function tickerHref(symbol: string): string {
  return `/decision?ticker=${encodeURIComponent(symbol.trim().toUpperCase())}`;
}

export function TickerLink({
  symbol,
  className = '',
  /** Set when the surrounding cell already states the company. */
  label,
}: {
  symbol: string;
  className?: string;
  label?: string;
}) {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return null;

  return (
    <Link
      href={tickerHref(clean)}
      title={`Open ${clean} on the decision page`}
      className={`rounded-[2px] underline decoration-transparent decoration-dotted underline-offset-2 transition-colors hover:decoration-pos focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-pos ${className}`}
    >
      {label ?? clean}
    </Link>
  );
}
