'use client';

import { useEffect, useRef, useState } from 'react';
import type { TickerChartData } from '@/lib/ticker/types';

/**
 * Daily price chart with the 50- and 200-day averages overlaid.
 *
 * lightweight-charts touches `document` on construction, so the chart is built
 * inside an effect and never during render — which also keeps it out of the
 * server bundle entirely.
 */

/* Mirrors the CSS variables in globals.css; the chart library needs literals. */
const COLOR = {
  // Direction stays green/red regardless of theme.
  up: '#3ddc84',
  down: '#ff5c7a',
  ma50: '#f0a500', // brand amber
  ma200: '#4c8dff', // cool, so the two averages never blur together
  grid: '#161d2c',
  border: '#232c3f',
  text: '#8494a8',
  crosshair: '#5a687d',
};

interface Props {
  symbol: string;
  data: TickerChartData;
  currentPrice: number;
}

export function TickerChart({ symbol, data, currentPrice }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.candles.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    // Dynamic import keeps the ~50KB library out of the initial page payload
    // and off the server-rendering path.
    (async () => {
      try {
        const { createChart, CandlestickSeries, LineSeries, LineStyle } =
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
          timeScale: { borderColor: COLOR.border, rightOffset: 4 },
          crosshair: {
            vertLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
            horzLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
          },
        });

        const candles = chart.addSeries(CandlestickSeries, {
          upColor: COLOR.up,
          downColor: COLOR.down,
          borderUpColor: COLOR.up,
          borderDownColor: COLOR.down,
          wickUpColor: COLOR.up,
          wickDownColor: COLOR.down,
          priceLineVisible: false,
        });
        candles.setData(data.candles);

        if (data.ma200.length > 0) {
          const ma200 = chart.addSeries(LineSeries, {
            color: COLOR.ma200,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          ma200.setData(data.ma200);
        }

        if (data.ma50.length > 0) {
          const ma50 = chart.addSeries(LineSeries, {
            color: COLOR.ma50,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          ma50.setData(data.ma50);
        }

        // Marks where price is right now, which is not always the last candle's
        // close — the chain feed is more current than the daily bar.
        candles.createPriceLine({
          price: currentPrice,
          color: COLOR.text,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'now',
        });

        chart.timeScale().fitContent();

        cleanup = () => chart.remove();
      } catch {
        // A chart that fails to load must not take the page down with it —
        // the signal analysis below is the point of this page.
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [data, currentPrice]);

  const legend = [
    { label: 'Price', color: COLOR.up },
    { label: '50-day', color: COLOR.ma50 },
    { label: '200-day', color: COLOR.ma200 },
  ];

  return (
    <figure className="panel p-0">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-term-line px-3.5 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
          {symbol} — daily, {data.candles.length} sessions
        </h2>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-2xs text-term-faint">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 border-t border-dashed"
              style={{ borderColor: COLOR.text }}
            />
            now
          </span>
        </div>
      </figcaption>

      {failed ? (
        <p className="px-3.5 py-10 text-center text-xs text-term-dim">
          The chart could not be loaded. The analysis below is unaffected.
        </p>
      ) : (
        <div
          ref={containerRef}
          className="h-[340px] w-full sm:h-[400px]"
          role="img"
          aria-label={`${symbol} daily candlestick chart over ${data.candles.length} sessions with 50-day and 200-day moving averages.`}
        />
      )}
    </figure>
  );
}
