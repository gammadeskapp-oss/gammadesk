import type { WhyHere } from '@/lib/scanner/daily20Reason';

/**
 * The Decision page's top "Why this is here today" block, when the ticker on
 * screen is in today's Daily 20. Conditions only — the watch line is the one
 * caution, and nothing here is an instruction.
 */
export function WhyHereToday({ why, direction }: { why: WhyHere; direction: 'bullish' | 'bearish' }) {
  const accent = direction === 'bullish' ? 'border-l-bull/60' : 'border-l-bear/60';
  return (
    <section className={`panel border-l-2 ${accent} px-3.5 py-3`} aria-label="Why this is here today">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-term-text">
          Why this is here today
        </h2>
        <span className="text-2xs text-term-dim">{why.title}</span>
      </div>
      <ul className="mt-2 space-y-1 text-xs leading-relaxed text-term-dim">
        {why.lines.map((line, i) => {
          const isWatch = line === why.watch;
          return (
            <li key={i} className={isWatch ? 'text-flip/90' : undefined}>
              {isWatch ? line : <>• {line}</>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
