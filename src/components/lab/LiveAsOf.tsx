'use client';

import { useEffect, useState } from 'react';

/** Older than this and the stream is called stale. */
const STALE_AFTER_MS = 20_000;

/**
 * "as of <time>" for a live-feed reading, greyed and labelled once the newest
 * event is more than 20 seconds old.
 *
 * The first render prints the server's label unchanged so hydration matches;
 * the age is only computed after mount, against the viewer's clock, and
 * re-checked every second so a stream that stops is called stale without
 * waiting for the next refresh.
 */
export function LiveAsOf({ asOfMs, label }: { asOfMs: number | null; label: string | null }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // First tick on the next frame rather than synchronously in the effect.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  if (!asOfMs || !label) {
    return <span className="text-term-faint">no reading from the stream</span>;
  }

  const age = now === null ? 0 : now - asOfMs;
  const stale = age > STALE_AFTER_MS;
  const clock = new Date(asOfMs).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <span
      className={stale ? 'text-term-faint opacity-60' : 'text-term-dim'}
      title={label}
      data-stale={stale ? 'true' : 'false'}
    >
      as of <span className="tabular-nums">{now === null ? label : `${clock} ET`}</span>
      {stale && (
        <span className="ml-1 font-bold">
          · stale — no update from the stream for {Math.round(age / 1000)}s
        </span>
      )}
    </span>
  );
}
