'use client';

import { METRIC_ORDER, METRICS } from '@/lib/metrics';
import type { MetricKey } from '@/lib/types';

interface TabBarProps {
  active: MetricKey;
  onChange: (metric: MetricKey) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Exposure metric"
      className="flex flex-wrap gap-1"
    >
      {METRIC_ORDER.map((key) => {
        const def = METRICS[key];
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={selected}
            aria-controls="positioning-panel"
            onClick={() => onChange(key)}
            title={def.name}
            className={`border px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
              selected
                ? 'border-pos/60 bg-pos/12 text-pos shadow-[inset_0_-2px_0_0_rgba(34,211,238,0.85)]'
                : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
            }`}
          >
            {def.tab}
          </button>
        );
      })}
    </div>
  );
}
