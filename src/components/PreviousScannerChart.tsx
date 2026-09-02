'use client';

import { useEffect, useRef, useState } from 'react';
import { nadarayaWatson, type NwSettings } from '@/lib/previousscanner/nadarayaWatson';
import { anchoredVwap, type SeriesBar } from '@/lib/previousscanner/series';
import {
  hasNw,
  SCAN_TIMEFRAMES,
  TIMEFRAME_LABEL,
  type Magnet,
  type ScanTimeframe,
  type VwapAnchor,
} from '@/lib/previousscanner/types';
import { ema } from '@/lib/ticker/indicators';

/**
 * The chart that opens under a scanner row.
 *
 * Separate from `InteractiveChart` on purpose, and it is worth saying why
 * rather than leaving it looking like duplication. That component is a general
 * charting surface: six timeframes, user-toggleable overlays, and a set of
 * overlay preferences shared across the whole app through localStorage. This
 * one has a single job — show the reader the same picture the scan just made a
 * decision from — so its overlay set is fixed, its colours are pinned to the
 * reader's own TradingView layout, and it draws the Nadaraya-Watson band and
 * the gamma magnets, neither of which the general chart knows about.
 *
 * Letting the two share would mean either bolting scanner-only overlays onto
 * every chart in the app, or making the scan's picture reconfigurable — and a
 * reader who had switched the 200 EMA off elsewhere would open a row here and
 * not see the line the row was judged against.
 *
 * No new dependency: `lightweight-charts` is already in the project, imported
 * dynamically so it stays off the server-rendering path and out of the initial
 * payload.
 */

/**
 * The reader's TradingView layout, matched exactly.
 *
 * The point of this page is to combine chart timing with gamma levels, which
 * only works if the chart here looks like the chart they already read. A
 * different palette would make them re-learn the same picture.
 */
const COLOR = {
  up: '#3ddc84',
  down: '#ff5c7a',
  ema9: '#22d3ee', // cyan
  ema13: '#ff5c5c', // red
  ema50: '#f5d90a', // yellow
  ema200: '#3ddc84', // green
  vwap: '#4c8dff', // thin blue
  nw: '#3ddc84', // green band
  magnet: '#f0a500',
  grid: '#161d2c',
  border: '#232c3f',
  text: '#8494a8',
  crosshair: '#5a687d',
};

interface SeriesResponse {
  symbol: string;
  timeframe: string;
  bars: SeriesBar[];
  intraday: boolean;
  asOfLabel: string;
}

export function PreviousScannerChart({
  symbol,
  magnets,
  nwSettings,
  vwapAnchor,
  trendEmaPeriod,
  initialTimeframe = '1D',
}: {
  symbol: string;
  /** Largest positive-GEX strikes from the 08:30 refresh. */
  magnets: Magnet[];
  nwSettings: NwSettings;
  /** Which anchor each timeframe's VWAP resets on, from config. */
  vwapAnchor: Record<string, VwapAnchor>;
  trendEmaPeriod: number;
  initialTimeframe?: ScanTimeframe;
}) {
  const [timeframe, setTimeframe] = useState<ScanTimeframe>(initialTimeframe);
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const loading = !error && (data?.timeframe !== timeframe || data?.symbol !== symbol);
  const anchor = vwapAnchor[timeframe] ?? 'session';

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: SeriesResponse) => {
        setData(body);
        setError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError('Could not load bars for this timeframe.');
      });

    return () => controller.abort();
  }, [symbol, timeframe]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data || data.bars.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

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
          timeScale: {
            borderColor: COLOR.border,
            rightOffset: 3,
            timeVisible: data.intraday,
            secondsVisible: false,
          },
          crosshair: {
            vertLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
            horzLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
          },
          localization: { locale: 'en-US' },
          /*
           * The row this chart sits inside is halfway down a long page. A
           * canvas that swallows the wheel traps a desktop reader, and one
           * that swallows a vertical swipe traps a phone reader completely.
           * Drag-to-pan and pinch-to-zoom both still work.
           */
          handleScroll: { vertTouchDrag: false, mouseWheel: false },
          handleScale: { mouseWheel: false },
        });

        // Strictly ascending and unique: the library rejects anything else,
        // and upstream very occasionally repeats a stamp.
        const bars = [...data.bars]
          .sort((a, b) => a.t - b.t)
          .filter((bar, i, all) => i === 0 || bar.t !== all[i - 1].t);

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
          bars.map((b) => ({
            time: b.t as never,
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
          })),
        );

        const closes = bars.map((b) => b.c);

        const line = (
          values: (number | null)[],
          colour: string,
          style: number,
          width: 1 | 2 = 1,
        ) => {
          const points = values
            .map((value, i) => ({ time: bars[i].t as never, value }))
            .filter((p): p is { time: never; value: number } => p.value !== null);
          if (points.length === 0) return;

          const series = chart.addSeries(LineSeries, {
            color: colour,
            lineWidth: width,
            lineStyle: style,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          series.setData(points);
        };

        line(ema(closes, 9), COLOR.ema9, LineStyle.Solid);
        line(ema(closes, 13), COLOR.ema13, LineStyle.Solid);
        line(ema(closes, 50), COLOR.ema50, LineStyle.Solid);
        line(ema(closes, trendEmaPeriod), COLOR.ema200, LineStyle.Solid);
        line(anchoredVwap(bars, anchor), COLOR.vwap, LineStyle.Dashed);

        /*
         * The Nadaraya-Watson envelope, drawn from the same function the scan
         * used. Three lines rather than a filled cloud: filling between two
         * series needs a custom series primitive in this library, and the two
         * edges plus a dashed centre carry the same reading — which side of
         * the band the close is on — without that machinery.
         *
         * Skipped entirely on timeframes the scan does not compute a band for.
         * Drawing one here that the row beside it withholds would be the worst
         * of both: the reader would read a level off the chart that no number
         * on the page agrees with.
         */
        if (hasNw(timeframe)) {
          const nw = nadarayaWatson(closes, nwSettings);
          line(nw.points.map((p) => p?.upper ?? null), COLOR.nw, LineStyle.Solid);
          line(nw.points.map((p) => p?.lower ?? null), COLOR.nw, LineStyle.Solid);
          line(nw.points.map((p) => p?.mid ?? null), COLOR.nw, LineStyle.Dotted);
        }

        /*
         * Gamma magnets from the 08:30 refresh. These are the whole reason the
         * chart is here rather than on its own page: the timing read and the
         * levels the book is pinned to belong in one picture.
         */
        for (const magnet of magnets) {
          candles.createPriceLine({
            price: magnet.strike,
            color: COLOR.magnet,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'GEX',
          });
        }

        chart.timeScale().fitContent();
        cleanup = () => chart.remove();
      } catch {
        if (!disposed) setError('The chart could not be drawn.');
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [data, magnets, nwSettings, anchor, trendEmaPeriod, timeframe]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {SCAN_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              aria-pressed={tf === timeframe}
              className={`border px-2 py-0.5 text-2xs font-bold tracking-[0.1em] transition-colors ${
                tf === timeframe
                  ? 'border-pos/70 bg-pos/15 text-pos'
                  : 'border-term-line text-term-faint hover:border-pos/50 hover:text-term-dim'
              }`}
            >
              {TIMEFRAME_LABEL[tf]}
            </button>
          ))}
        </div>
        <p className="text-2xs text-term-faint">
          {data?.asOfLabel ? `Bars to ${data.asOfLabel}` : ''}
          {' · '}
          {anchor}-anchored VWAP
          {!hasNw(timeframe) && ' · no NW band at this interval'}
        </p>
      </div>

      {error ? (
        <p className="px-2 py-8 text-center text-xs text-flip">{error}</p>
      ) : (
        <div className="relative">
          <div ref={containerRef} className="h-[380px] w-full" />
          {loading && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-term-faint">
              Loading bars…
            </p>
          )}
        </div>
      )}

      {/*
        Never hover-only. The legend is the only thing that says which green
        line is the 200 EMA and which is the NW band, and a reader on a phone
        has no hover at all.
      */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-term-faint">
        {[
          ['9 EMA', COLOR.ema9],
          ['13 EMA', COLOR.ema13],
          ['50 EMA', COLOR.ema50],
          [`${trendEmaPeriod} EMA`, COLOR.ema200],
          ['VWAP', COLOR.vwap],
          ...(hasNw(timeframe)
            ? ([['NW band', COLOR.nw]] as Array<[string, string]>)
            : []),
          ['Gamma magnet', COLOR.magnet],
        ].map(([label, colour]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-3"
              style={{ backgroundColor: colour }}
            />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
