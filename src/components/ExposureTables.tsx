'use client';

import { useState } from 'react';
import { PositioningTable } from './PositioningTable';
import { TabBar } from './TabBar';
import type { MetricKey, PositioningData } from '@/lib/types';

/** GEX, VEX and CEX — the three exposure views, without the raw OI tab. */
const EXPOSURE_TABS: MetricKey[] = ['gex', 'vex', 'cex'];

/**
 * The exposure grid, as it appears at the foot of /decision.
 *
 * Exactly the table the positioning book renders, on exactly the same data —
 * this is the working behind the walls and magnets named further up the page,
 * put where someone who wants to check a level can reach it without leaving
 * the ticker.
 */
export function ExposureTables({ data }: { data: PositioningData }) {
  const [metric, setMetric] = useState<MetricKey>('gex');

  return (
    <div className="space-y-2">
      <TabBar
        active={metric}
        onChange={setMetric}
        order={EXPOSURE_TABS}
        panelId="decision-exposure-panel"
      />
      <div
        id="decision-exposure-panel"
        role="tabpanel"
        aria-labelledby={`tab-${metric}`}
      >
        <PositioningTable data={data} metric={metric} />
      </div>
    </div>
  );
}
