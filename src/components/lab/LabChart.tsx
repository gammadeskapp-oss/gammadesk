'use client';

import { useEffect, useRef, useState } from 'react';
import { TIMEFRAMES, type Timeframe } from '@/lib/bars/types';
import { ema, rsi } from '@/lib/ticker/indicators';
import {
  DrawingPrimitive,
  type Drawing,
  type DrawingTool,
} from './drawingTools';

/**
 * Prototype chart for the drawing-tools evaluation on `/lab/charts`.
 *
 * It deliberately re-implements the same overlays the production
 * `InteractiveChart` draws — 9/13/50/200 EMA, session VWAP and an RSI(14) pane —
 * over the same `/api/bars` feed, so the only variable when comparing the two
 * side by side is the new hand-drawing layer. The overlay maths is a trimmed
 * copy of the production component's rather than a shared extraction: this is a
 * throwaway testbed, and coupling the live chart to it would be the wrong
 * dependency to create before the approach has been reviewed.
 */

const COLOR = {
  up: '#3ddc84',
  down: '#ff5c7a',
  ema9: '#f0a500',
  ema13: '#ff8a3d',
  ema50: '#4c8dff',
  ema200: '#8494a8',
  vwap: '#c8d6e5',
  rsi: '#f0a500',
  grid: '#161d2c',
  border: '#232c3f',
  text: '#8494a8',
  crosshair: '#5a687d',
  band: '#2f3a52',
};

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface SeriesResponse {
  symbol: string;
  timeframe: Timeframe;
  bars: Bar[];
  intraday: boolean;
  asOfLabel: string;
}

type OverlayKey = 'ema9' | 'ema13' | 'ema50' | 'ema200' | 'vwap' | 'rsi';

const OVERLAYS: { key: OverlayKey; label: string; colour: string; period?: number }[] = [
  { key: 'ema9', label: '9 EMA', colour: COLOR.ema9, period: 9 },
  { key: 'ema13', label: '13 EMA', colour: COLOR.ema13, period: 13 },
  { key: 'ema50', label: '50 EMA', colour: COLOR.ema50, period: 50 },
  { key: 'ema200', label: '200 EMA', colour: COLOR.ema200, period: 200 },
  { key: 'vwap', label: 'VWAP', colour: COLOR.vwap },
];

const DEFAULT_OVERLAYS: Record<OverlayKey, boolean> = {
  ema9: true,
  ema13: false,
  ema50: false,
  ema200: false,
  vwap: true,
  rsi: false,
};

const TOOLS: { key: DrawingTool; label: string; hint: string }[] = [
  { key: 'trendline', label: 'Trendline', hint: 'Click a start, then an end.' },
  { key: 'ray', label: 'Horizontal ray', hint: 'Click a price; it extends right.' },
  { key: 'fib', label: 'Fib retracement', hint: 'Click the swing high, then the low.' },
];

/** VWAP is meaningful only intraday, below an hour. */
function vwapApplies(tf: Timeframe): boolean {
  return tf === '1m' || tf === '5m' || tf === '15m';
}

/** Session-anchored VWAP, resetting on each New York calendar date. */
function vwapSeries(bars: Bar[]): (number | null)[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let day = '';
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const today = fmt.format(new Date(bar.t * 1000));
    if (today !== day) {
      day = today;
      pv = 0;
      vol = 0;
    }
    const typical = (bar.h + bar.l + bar.c) / 3;
    pv += typical * bar.v;
    vol += bar.v;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

function storageKey(symbol: string): string {
  return `gammadesk.lab.drawings.${symbol.toUpperCase()}`;
}

function loadDrawings(symbol: string): Drawing[] {
  try {
    const raw = window.localStorage.getItem(storageKey(symbol));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
  } catch {
    return [];
  }
}

function saveDrawings(symbol: string, drawings: Drawing[]): void {
  try {
    window.localStorage.setItem(storageKey(symbol), JSON.stringify(drawings));
  } catch {
    // Storage may be unavailable; the drawings still live for this session.
  }
}

export function LabChart({
  symbol,
  initialTimeframe = '15m',
}: {
  symbol: string;
  initialTimeframe?: Timeframe;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [overlays, setOverlays] =
    useState<Record<OverlayKey, boolean>>(DEFAULT_OVERLAYS);
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tool, setTool] = useState<DrawingTool | null>(null);
  const [drawingCount, setDrawingCount] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const primitiveRef = useRef<DrawingPrimitive | null>(null);
  const seriesRef = useRef<
    Partial<Record<OverlayKey, { applyOptions: (o: object) => void }>>
  >({});
  /** Committed drawings, held in a ref so a chart rebuild can re-seed them. */
  const drawingsRef = useRef<Drawing[]>([]);
  /** The first anchor of a two-click placement, or null between drawings. */
  const pendingRef = useRef<Drawing['a'] | null>(null);
  /** Live tool, read inside chart callbacks without re-subscribing. */
  const toolRef = useRef<DrawingTool | null>(null);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  const loading =
    !error && (data?.timeframe !== timeframe || data?.symbol !== symbol);

  // --- fetch bars ---
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

  // --- load persisted drawings when the symbol changes ---
  // A legitimate external-store read on mount: the saved drawings live in
  // localStorage, not React, and must be pulled in once the client is up.
  // `symbol` is stable per mount here — the picker is a full navigation — so
  // this runs once and does not cascade.
  useEffect(() => {
    const restored = loadDrawings(symbol);
    drawingsRef.current = restored;
    primitiveRef.current?.setDrawings(restored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawingCount(restored.length);
  }, [symbol]);

  // --- build the chart ---
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
            panes: { separatorColor: COLOR.border, separatorHoverColor: COLOR.band },
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
        });

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
        for (const overlay of OVERLAYS) {
          const values = overlay.period
            ? ema(closes, overlay.period)
            : vwapSeries(bars);
          const points = values
            .map((value, i) => ({ time: bars[i].t as never, value }))
            .filter((p): p is { time: never; value: number } => p.value !== null);
          if (points.length === 0) continue;
          const usable = overlay.key === 'vwap' ? vwapApplies(data.timeframe) : true;
          const line = chart.addSeries(LineSeries, {
            color: overlay.colour,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            lineStyle: overlay.key === 'vwap' ? LineStyle.Dashed : LineStyle.Solid,
            visible: usable && overlays[overlay.key],
          });
          line.setData(points);
          seriesRef.current[overlay.key] = line;
        }

        if (overlays.rsi) {
          const rsiPoints = rsi(closes, 14)
            .map((value, i) => ({ time: bars[i].t as never, value }))
            .filter((p): p is { time: never; value: number } => p.value !== null);
          if (rsiPoints.length > 0) {
            const rsiSeries = chart.addSeries(
              LineSeries,
              {
                color: COLOR.rsi,
                lineWidth: 1,
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: false,
              },
              1,
            );
            rsiSeries.setData(rsiPoints);
            for (const level of [70, 30]) {
              rsiSeries.createPriceLine({
                price: level,
                color: COLOR.band,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: String(level),
              });
            }
            rsiSeries.applyOptions({
              autoscaleInfoProvider: () => ({
                priceRange: { minValue: 0, maxValue: 100 },
              }),
            });
            rsiSeries.priceScale().applyOptions({
              scaleMargins: { top: 0.08, bottom: 0.08 },
            });
            const panes = chart.panes();
            if (panes.length > 1) panes[1].setHeight(110);
          }
        }

        // --- drawing layer ---
        const primitive = new DrawingPrimitive();
        candles.attachPrimitive(primitive);
        primitive.setDrawings(drawingsRef.current);
        primitiveRef.current = primitive;

        // Open on the whole fetched window; the point here is the tools, not
        // the exact framing the production chart tunes.
        chart.timeScale().fitContent();

        // A click either sets the first anchor of a new drawing or completes
        // the pending one. Price comes from the candles' own scale; time from
        // the hovered bar. A click in empty space past the last bar has no
        // time and is ignored.
        const onClick = (param: {
          time?: unknown;
          point?: { x: number; y: number };
        }) => {
          const active = toolRef.current;
          if (!active || !param.point || param.time === undefined) return;
          const price = candles.coordinateToPrice(param.point.y);
          if (price === null) return;
          const anchor = { time: param.time as never, price };

          // A horizontal ray needs only a price, so one click commits it. The
          // two-click tools set their first anchor, preview, then commit.
          const commit = (drawing: Drawing) => {
            pendingRef.current = null;
            primitive.setDraft(null);
            const next = [...drawingsRef.current, drawing];
            drawingsRef.current = next;
            primitive.setDrawings(next);
            saveDrawings(symbol, next);
            setDrawingCount(next.length);
          };

          const newId = () =>
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          if (active === 'ray') {
            commit({ id: newId(), tool: 'ray', a: anchor, b: anchor });
            return;
          }

          if (!pendingRef.current) {
            pendingRef.current = anchor;
            primitive.setDraft({ id: 'draft', tool: active, a: anchor, b: anchor });
            return;
          }

          commit({ id: newId(), tool: active, a: pendingRef.current, b: anchor });
        };

        // While a first anchor is down, the second follows the crosshair so
        // the line previews before it is committed.
        const onMove = (param: {
          time?: unknown;
          point?: { x: number; y: number };
        }) => {
          const start = pendingRef.current;
          const active = toolRef.current;
          if (!start || !active || !param.point || param.time === undefined) return;
          const price = candles.coordinateToPrice(param.point.y);
          if (price === null) return;
          primitive.setDraft({
            id: 'draft',
            tool: active,
            a: start,
            b: { time: param.time as never, price },
          });
        };

        chart.subscribeClick(onClick as never);
        chart.subscribeCrosshairMove(onMove as never);

        cleanup = () => {
          seriesRef.current = {};
          primitiveRef.current = null;
          chart.unsubscribeClick(onClick as never);
          chart.unsubscribeCrosshairMove(onMove as never);
          chart.remove();
        };
      } catch {
        if (!disposed) setError('The chart could not be drawn.');
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // Overlay toggles that only flip visibility are handled below without a
    // rebuild; RSI changes the pane structure, so it rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, overlays.rsi, symbol]);

  // --- toggle line overlays without rebuilding ---
  useEffect(() => {
    for (const overlay of OVERLAYS) {
      const series = seriesRef.current[overlay.key];
      if (!series) continue;
      const usable = overlay.key === 'vwap' ? vwapApplies(timeframe) : true;
      series.applyOptions({ visible: usable && overlays[overlay.key] });
    }
  }, [overlays, timeframe]);

  const toggle = (key: OverlayKey) =>
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));

  const chooseTool = (key: DrawingTool) => {
    // Selecting a tool while mid-placement abandons the pending anchor.
    pendingRef.current = null;
    primitiveRef.current?.setDraft(null);
    setTool((prev) => (prev === key ? null : key));
  };

  const undo = () => {
    const next = drawingsRef.current.slice(0, -1);
    drawingsRef.current = next;
    primitiveRef.current?.setDrawings(next);
    saveDrawings(symbol, next);
    setDrawingCount(next.length);
  };

  const clear = () => {
    drawingsRef.current = [];
    pendingRef.current = null;
    primitiveRef.current?.setDraft(null);
    primitiveRef.current?.setDrawings([]);
    saveDrawings(symbol, []);
    setDrawingCount(0);
  };

  const activeHint = tool ? TOOLS.find((t) => t.key === tool)?.hint : null;

  return (
    <figure className="panel p-0">
      <figcaption className="space-y-2 border-b border-term-line px-3 py-2.5">
        {/* Timeframe */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            role="group"
            aria-label="Timeframe"
            className="flex flex-wrap items-center gap-1"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                aria-pressed={tf === timeframe}
                className={`min-w-[2.75rem] border px-2.5 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] transition-colors ${
                  tf === timeframe
                    ? 'border-pos/60 bg-pos/15 text-pos'
                    : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <span className="ml-auto text-2xs text-term-faint">
            {loading ? 'loading…' : data ? `${data.bars.length} bars` : ''}
          </span>
        </div>

        {/* Overlays */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {OVERLAYS.map((overlay) => {
            if (overlay.key === 'vwap' && !vwapApplies(timeframe)) return null;
            return (
              <label
                key={overlay.key}
                className="flex cursor-pointer items-center gap-1.5 py-1 text-2xs tracking-[0.08em] text-term-dim"
              >
                <input
                  type="checkbox"
                  checked={overlays[overlay.key]}
                  onChange={() => toggle(overlay.key)}
                  className="h-3.5 w-3.5 shrink-0 accent-[#f0a500]"
                />
                <span
                  aria-hidden
                  className="h-0.5 w-3.5 shrink-0"
                  style={{
                    background: overlay.colour,
                    opacity: overlays[overlay.key] ? 1 : 0.3,
                  }}
                />
                {overlay.label}
              </label>
            );
          })}
          <label className="flex cursor-pointer items-center gap-1.5 py-1 text-2xs tracking-[0.08em] text-term-dim">
            <input
              type="checkbox"
              checked={overlays.rsi}
              onChange={() => toggle('rsi')}
              className="h-3.5 w-3.5 shrink-0 accent-[#f0a500]"
            />
            <span
              aria-hidden
              className="h-0.5 w-3.5 shrink-0"
              style={{ background: COLOR.rsi, opacity: overlays.rsi ? 1 : 0.3 }}
            />
            RSI
          </label>
        </div>

        {/* Drawing tools */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-term-line pt-2">
          <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
            Draw
          </span>
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => chooseTool(t.key)}
              aria-pressed={tool === t.key}
              className={`border px-2.5 py-1.5 text-2xs font-bold uppercase tracking-[0.08em] transition-colors ${
                tool === t.key
                  ? 'border-pos/60 bg-pos/15 text-pos'
                  : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={drawingCount === 0}
              className="border border-term-line bg-term-panel/60 px-2.5 py-1.5 text-2xs uppercase tracking-[0.08em] text-term-faint transition-colors hover:border-term-edge hover:text-term-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={drawingCount === 0}
              className="border border-term-line bg-term-panel/60 px-2.5 py-1.5 text-2xs uppercase tracking-[0.08em] text-term-faint transition-colors hover:border-neg/60 hover:text-neg disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        <p className="text-2xs leading-relaxed text-term-faint">
          {activeHint ? (
            <span className="text-flip">{activeHint}</span>
          ) : (
            'Pick a tool, then click on the chart to place it. Drawings are saved per symbol and survive a reload.'
          )}
          {drawingCount > 0 &&
            ` · ${drawingCount} drawing${drawingCount > 1 ? 's' : ''} on ${symbol.toUpperCase()}`}
        </p>
      </figcaption>

      {error ? (
        <p className="px-3.5 py-10 text-center text-xs text-term-dim">{error}</p>
      ) : (
        <div
          ref={containerRef}
          className="h-[420px] w-full sm:h-[520px]"
          role="img"
          aria-label={`${symbol} ${timeframe} candlestick chart with drawing tools.`}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-term-line px-3 py-2 text-2xs text-term-faint">
        <span>
          <span className="text-flip">15-min delayed</span> · prototype · drawing
          tools via lightweight-charts primitives
        </span>
        {data && <span className="tabular-nums">last bar {data.asOfLabel}</span>}
      </div>
    </figure>
  );
}
