import type { ChangeKind, ChangeLine } from '@/lib/scanner/daily20Diff';

/**
 * The "What Changed Today" feed — how the Daily 20's leadership shifted since
 * the previous session, in plain-English lines.
 *
 * The point of the panel is to surface *when leadership is strengthening or
 * failing*, not just who ranks high today. It is empty on the first stored
 * session (nothing to compare against) and says so. Lines describe what
 * changed; none is an instruction.
 */

const KIND_TONE: Record<ChangeKind, string> = {
  entrant: 'text-bull',
  'setup-confirmed': 'text-bull',
  'rank-move': 'text-term-text',
  'side-flip': 'text-flip',
  'regime-flip': 'text-flip',
  'setup-failed': 'text-bear',
  exit: 'text-bear',
};

export function WhatChangedToday({ changes }: { changes: ChangeLine[] }) {
  return (
    <section className="panel" aria-label="What changed today">
      <div className="border-b border-term-line px-3.5 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-term-text">
          What changed today
        </h2>
      </div>
      {changes.length === 0 ? (
        <p className="px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          Nothing to compare yet — this is the first stored session, or the Daily 20 is
          unchanged since the last one. The feed fills in from the next session on.
        </p>
      ) : (
        <ul className="divide-y divide-term-line/60">
          {changes.map((c, i) => (
            <li key={`${c.kind}-${c.symbol}-${i}`} className="flex gap-2 px-3.5 py-1.5 text-2xs leading-relaxed">
              <span className={`shrink-0 font-bold ${KIND_TONE[c.kind]}`} aria-hidden>
                •
              </span>
              <span className="text-term-dim">{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
