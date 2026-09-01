'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The last-resort error screen.
 *
 * ## What this may say, and what it may not
 *
 * It used to print environment variable names and advice about which provider
 * plan includes which endpoint. That is a note to whoever runs the deployment,
 * and this is the screen a visitor sees — it named internal configuration to
 * someone who cannot act on it and did not ask, which is both useless and a
 * small disclosure of how the thing is wired.
 *
 * So the copy here says only what is true for a reader: today's data is not
 * available yet. The operational detail — which provider is configured, which
 * credential is missing, whether a snapshot exists — lives on `/status`, which
 * is linked rather than summarised. One place for it, and it is a page you
 * reach on purpose.
 *
 * The digest stays. It is an opaque identifier with no content in it, and it
 * is the only thing that connects what a reader saw to a line in the logs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The detail goes to the server logs, where it is useful, and not to the
    // screen, where it is not.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-20">
      <div className="panel border-l-2 border-l-neg/60 p-6">
        <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-neg">
          Today&rsquo;s data isn&rsquo;t available yet
        </h1>

        <p className="mt-3 text-xs leading-relaxed text-term-dim">
          This page is built from live market data, and that data could not be
          read just now. Nothing is estimated or filled in when that happens, so
          the page stops rather than showing numbers it cannot stand behind.
        </p>

        <p className="mt-2 text-xs leading-relaxed text-term-dim">
          It is usually brief. Try again in a few minutes.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="border border-term-edge bg-term-panel px-4 py-2 text-xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:text-term-text"
          >
            Try again
          </button>

          <Link
            href="/status"
            className="text-xs text-term-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-term-dim"
          >
            What&rsquo;s running, and what isn&rsquo;t
          </Link>
        </div>

        {error.digest && (
          <p className="mt-4 text-2xs text-term-faint">
            Reference: <span className="text-term-dim">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
