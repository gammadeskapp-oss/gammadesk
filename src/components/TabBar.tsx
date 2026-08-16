'use client';

import { InfoTip } from './InfoTip';
import { METRIC_ORDER, METRICS } from '@/lib/metrics';
import type { MetricKey } from '@/lib/types';

interface TabBarProps {
  active: MetricKey;
  onChange: (metric: MetricKey) => void;
  /**
   * Which metrics to offer. Defaults to all four; /decision shows only the
   * three exposure tabs, because the raw open interest behind them is a
   * positioning-book question rather than a one-ticker one.
   */
  order?: MetricKey[];
  /** The panel these tabs drive, for `aria-controls`. */
  panelId?: string;
}

export function TabBar({
  active,
  onChange,
  order = METRIC_ORDER,
  panelId = 'positioning-panel',
}: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Exposure metric"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
    >
      {order.map((key) => {
        const def = METRICS[key];
        const selected = key === active;
        return (
          // The `?` sits outside the tab rather than inside it: a button
          // nested in a button is invalid, and tapping the help must not
          // switch metric. The wrapper is presentational so the tablist still
          // owns the tabs directly.
          <div key={key} role="presentation" className="flex items-center gap-1">
            <button
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => onChange(key)}
              title={def.name}
              className={`border px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
                selected
                  ? 'border-pos/60 bg-pos/12 text-pos shadow-[inset_0_-2px_0_0_rgba(240,165,0,0.85)]'
                  : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
              }`}
            >
              {def.tab}
            </button>
            <InfoTip for={key} />
          </div>
        );
      })}
    </div>
  );
}
