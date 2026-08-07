'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-20">
      <div className="panel border-l-2 border-l-neg/60 p-6">
        <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-neg">
          Dashboard failed to load
        </h1>

        <p className="mt-3 text-xs leading-relaxed text-term-dim">
          The positioning snapshot could not be built. The usual causes are a
          missing or invalid <code className="text-term-text">POLYGON_API_KEY</code>,
          or Polygon&rsquo;s free-plan limit of 5 requests per minute being hit.
        </p>

        {error.digest && (
          <p className="mt-3 text-2xs text-term-faint">
            Error digest: <span className="text-term-dim">{error.digest}</span>
          </p>
        )}

        <button
          type="button"
          onClick={reset}
          className="mt-5 border border-term-edge bg-term-panel px-4 py-2 text-xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:text-term-text"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
