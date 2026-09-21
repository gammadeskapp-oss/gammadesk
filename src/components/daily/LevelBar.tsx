import type { LevelMarker } from '@/lib/daily/view';

/**
 * The little horizontal level picture shared by /daily and /daily/[ticker]:
 * floor, balance point, now, and ceiling placed along one track.
 *
 * Extracted from the SPY page so the ticker pages draw the exact same visual
 * with the exact same colours, rather than a near-copy that can drift.
 */
export function LevelBar({ markers }: { markers: LevelMarker[] }) {
  const colour: Record<LevelMarker['key'], string> = {
    floor: 'text-pos',
    ceiling: 'text-neg',
    flip: 'text-flip',
    spot: 'text-term-text',
  };
  const dot: Record<LevelMarker['key'], string> = {
    floor: 'bg-pos',
    ceiling: 'bg-neg',
    flip: 'bg-flip',
    spot: 'bg-term-text',
  };
  // Sort so overlapping labels alternate above/below the track by position.
  const sorted = [...markers].sort((a, b) => a.pct - b.pct);

  return (
    <div className="mt-5 pt-8 pb-10">
      <div className="relative h-1.5 rounded-full bg-term-line">
        {sorted.map((m, i) => {
          const above = i % 2 === 0;
          return (
            <div
              key={m.key}
              className="absolute -translate-x-1/2"
              style={{ left: `${m.pct}%`, top: '50%', transform: `translate(-50%, -50%)` }}
            >
              <div className={`h-3 w-3 rounded-full ${dot[m.key]} ring-2 ring-term-bg`} />
              <div
                className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center ${
                  above ? 'bottom-5' : 'top-5'
                }`}
              >
                <div className={`text-2xs font-bold uppercase tracking-[0.12em] ${colour[m.key]}`}>{m.label}</div>
                <div className={`text-xs font-bold tabular-nums ${colour[m.key]}`}>{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
