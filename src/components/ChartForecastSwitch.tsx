'use client';

import { useState, type ReactNode } from 'react';
import { InteractiveChart } from './InteractiveChart';

/**
 * One area, two views of the same ticker: the interactive chart and the
 * forecast cone.
 *
 * They answer different halves of the same question — what price has done, and
 * what the simulation thinks the spread of the next few weeks looks like — and
 * both want the full width. Stacking them pushed the exposure tables off the
 * bottom of the page; side by side, neither is wide enough to read.
 *
 * The cone is rendered on the server and handed in as a node, because it is
 * static SVG built from a Monte Carlo run. Mounting it here costs no client
 * JavaScript, and both views stay in the DOM once opened so switching back
 * does not rebuild the chart.
 */
export function ChartForecastSwitch({
  symbol,
  forecast,
}: {
  symbol: string;
  /** The forecast cone, or a panel explaining why there isn't one. */
  forecast: ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'forecast'>('chart');

  const tab = (selected: boolean) =>
    `border px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
      selected
        ? 'border-pos/60 bg-pos/12 text-pos shadow-[inset_0_-2px_0_0_rgba(240,165,0,0.85)]'
        : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
    }`;

  return (
    <div className="space-y-2">
      <div
        role="tablist"
        aria-label="Chart or forecast"
        className="flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          role="tab"
          id="tab-view-chart"
          aria-selected={view === 'chart'}
          aria-controls="decision-view-panel"
          onClick={() => setView('chart')}
          className={tab(view === 'chart')}
        >
          Chart
        </button>
        <button
          type="button"
          role="tab"
          id="tab-view-forecast"
          aria-selected={view === 'forecast'}
          aria-controls="decision-view-panel"
          onClick={() => setView('forecast')}
          className={tab(view === 'forecast')}
        >
          Forecast
        </button>
        <span className="text-2xs text-term-faint">
          {view === 'chart'
            ? 'delayed price bars, with overlays'
            : 'simulated range — not a prediction'}
        </span>
      </div>

      <div
        id="decision-view-panel"
        role="tabpanel"
        aria-labelledby={view === 'chart' ? 'tab-view-chart' : 'tab-view-forecast'}
      >
        {/*
          Hidden rather than unmounted. The chart holds a lightweight-charts
          instance and its own timeframe and overlay state, and tearing that
          down every time someone glances at the cone would reset the view they
          had set up and refetch the bars.
        */}
        <div hidden={view !== 'chart'}>
          <InteractiveChart symbol={symbol} />
        </div>
        <div hidden={view !== 'forecast'}>{forecast}</div>
      </div>
    </div>
  );
}
