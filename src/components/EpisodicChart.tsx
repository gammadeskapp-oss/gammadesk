'use client';

import { useEffect, useRef } from 'react';
import type { EpisodicBar } from '@/lib/episodic/types';

/**
 * The 60-day daily chart that opens under an episodic-pivot row.
 *
 * Its whole job is to make the shape legible at a glance: a flat, ignored base,
 * then the jump, then whatever the name has done since — with the gap day
 * marked so the eye lands on it. So the bars are handed in from the stored
 * finding rather than fetched (the scan already had them, and a chart per row
 * that each spent an upstream request would defeat the point of a stored scan),
 * and the overlay set is fixed: the gap marker, the gap-day midpoint the "held"
 * flag is measured against, and the current tight-range high as a reference.
 *
 * No new dependency: `lightweight-charts` is already in the project, imported
 * dynamically so it stays off the server-rendering path.
 */

const COLOR = {
  up: '#3ddc84',
  down: '#ff5c7a',
  gap: '#f0a500',
  mid: '#5a687d',
  tight: '#22d3ee',
  grid: '#161d2c',
  border: '#232c3f',
  text: '#8494a8',
  crosshair: '#5a687d',
};

export function EpisodicChart({
  bars,
  gapDate,
  midpoint,
  tightRangeHigh,
}: {
  bars: EpisodicBar[];
  gapDate: string;
  midpoint: number;
  tightRangeHigh: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { createChart, CandlestickSeries, LineStyle, createSeriesMarkers } =
          await import('lightweight-charts');
        if (disposed || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
          autoSize: true,
          layout: {
            background: { color: 'transparent' },
            textColor: COLOR.text,
            fontSize: 11,
            fontFamily:
              "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace",
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: COLOR.grid },
            horzLines: { color: COLOR.grid },
          },
          rightPriceScale: { borderColor: COLOR.border },
          timeScale: { borderColor: COLOR.border, rightOffset: 3, secondsVisible: false },
          crosshair: {
            vertLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
            horzLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
          },
          localization: { locale: 'en-US' },
          // The row sits well down a long page; a canvas that swallows the
          // wheel or a vertical swipe would trap the reader. Drag and pinch
          // still pan and zoom.
          handleScroll: { vertTouchDrag: false, mouseWheel: false },
          handleScale: { mouseWheel: false },
        });

        // Strictly ascending, unique dates — the library rejects anything else.
        const clean = [...bars]
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .filter((bar, i, all) => i === 0 || bar.date !== all[i - 1].date);

        const candles = chart.addSeries(CandlestickSeries, {
          upColor: COLOR.up,
          downColor: COLOR.down,
          borderUpColor: COLOR.up,
          borderDownColor: COLOR.down,
          wickUpColor: COLOR.up,
          wickDownColor: COLOR.down,
          priceLineVisible: false,
        });
        candles.setData(
          clean.map((b) => ({
            time: b.date as never,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          })),
        );

        // The gap day, marked.
        createSeriesMarkers(candles, [
          {
            time: gapDate as never,
            position: 'belowBar',
            color: COLOR.gap,
            shape: 'arrowUp',
            text: 'GAP',
          },
        ]);

        // The gap-day midpoint — the level "held above mid" is measured against.
        candles.createPriceLine({
          price: midpoint,
          color: COLOR.mid,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'gap mid',
        });

        // The current tight-range high, when the pause has one.
        if (tightRangeHigh !== null) {
          candles.createPriceLine({
            price: tightRangeHigh,
            color: COLOR.tight,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: 'range high',
          });
        }

        chart.timeScale().fitContent();
        cleanup = () => chart.remove();
      } catch {
        // A chart that cannot draw leaves the row's numbers intact; there is
        // nothing useful to say in its place, so it simply stays blank.
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [bars, gapDate, midpoint, tightRangeHigh]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="h-[260px] w-full" />
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-term-faint">
        {[
          ['Gap day', COLOR.gap],
          ['Gap-day midpoint', COLOR.mid],
          ['Tight-range high', COLOR.tight],
        ].map(([label, colour]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3" style={{ backgroundColor: colour }} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
