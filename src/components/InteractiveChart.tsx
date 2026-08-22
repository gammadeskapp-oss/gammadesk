'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isTimeframe, TIMEFRAMES, type Timeframe } from '@/lib/bars/types';
import { ema, rsi } from '@/lib/ticker/indicators';
import {
  VolumeProfilePrimitive,
  type VolumeProfileColours,
} from './volumeProfileOverlay';
import { DEFAULT_BUCKET_COUNT } from '@/lib/profile';

/**
 * Candlesticks with toggleable overlays and an RSI pane.
 *
 * lightweight-charts touches `document` on construction, so the chart is built
 * inside an effect and the library is imported dynamically — that keeps ~50KB
 * out of the initial payload and off the server-rendering path entirely.
 *
 * Indicators are derived in the browser from the bars the API already sent.
 * Toggling an overlay therefore costs nothing and never refetches, and
 * switching timeframe is the only thing that touches the network.
 */

/* Mirrors globals.css. The library needs literals, not CSS variables. */
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

/*
 * The profile is context, not signal, so its buckets sit back in a cool
 * neutral and only the POC is allowed to be loud.
 *
 * The overlay draws beneath the candles, so these no longer have to be faint
 * enough to read price through — but they are still translucent, because the
 * grid and the moving averages pass behind the histogram as well, and a solid
 * block there would read as a hole punched in the chart.
 */
const PROFILE_COLOURS: VolumeProfileColours = {
  bucket: 'rgba(96, 118, 150, 0.38)',
  valueArea: 'rgba(140, 172, 214, 0.5)',
  valueAreaFill: 'rgba(96, 118, 150, 0.1)',
  poc: 'rgba(224, 95, 158, 0.85)',
};

/** Legend swatch for the POC line, matching what the canvas draws. */
const POC_SWATCH = '#e05f9e';

// --- overlay preferences -----------------------------------------------------

export type OverlayKey = 'ema9' | 'ema13' | 'ema50' | 'ema200' | 'vwap';

interface Overlay {
  key: OverlayKey;
  label: string;
  colour: string;
  period?: number;
  /** VWAP is meaningless on a daily series; it resets every session. */
  intradayOnly?: boolean;
}

const OVERLAYS: Overlay[] = [
  { key: 'ema9', label: '9 EMA', colour: COLOR.ema9, period: 9 },
  { key: 'ema13', label: '13 EMA', colour: COLOR.ema13, period: 13 },
  { key: 'ema50', label: '50 EMA', colour: COLOR.ema50, period: 50 },
  { key: 'ema200', label: '200 EMA', colour: COLOR.ema200, period: 200 },
  { key: 'vwap', label: 'VWAP', colour: COLOR.vwap, intradayOnly: true },
];

type OverlayState = Record<OverlayKey, boolean>;

const DEFAULT_OVERLAYS: OverlayState = {
  ema9: true,
  ema13: false,
  ema50: true,
  ema200: true,
  vwap: true,
};

const OVERLAY_KEY = 'gammadesk.chart.overlays';
const TF_KEY = 'gammadesk.chart.timeframe';
const PROFILE_KEY = 'gammadesk.chart.volumeProfile';
const STORE_EVENT = 'gammadesk:chart';

/*
 * Parsed value is memoised against the raw string.
 *
 * `useSyncExternalStore` compares snapshots by reference and will loop
 * forever if the getter builds a fresh object each call, which parsing JSON
 * does. Re-parsing only when the stored text actually changes keeps the
 * reference stable.
 */
let cachedRaw: string | null = null;
let cachedValue: OverlayState = DEFAULT_OVERLAYS;

function readOverlays(): OverlayState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(OVERLAY_KEY);
  } catch {
    return DEFAULT_OVERLAYS;
  }
  if (raw === cachedRaw) return cachedValue;

  cachedRaw = raw;
  cachedValue = DEFAULT_OVERLAYS;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<OverlayState>;
      const next = { ...DEFAULT_OVERLAYS };
      for (const { key } of OVERLAYS) {
        if (typeof parsed[key] === 'boolean') next[key] = parsed[key];
      }
      cachedValue = next;
    } catch {
      // Corrupt value: fall back to defaults rather than break the chart.
    }
  }

  return cachedValue;
}

function subscribeStore(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(STORE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
}

function writeOverlays(value: OverlayState): void {
  try {
    window.localStorage.setItem(OVERLAY_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the event still syncs this session.
  }
  window.dispatchEvent(new CustomEvent(STORE_EVENT));
}

/**
 * Timeframe is held in the same store rather than in component state.
 *
 * It has to survive a reload like the overlays do, and seeding `useState` from
 * localStorage would make the first client render disagree with the server's.
 * Reading it through the store means the server renders the default, the
 * browser re-renders with the stored value, and hydration stays consistent.
 */
function readStoredTimeframe(fallback: Timeframe): Timeframe {
  try {
    const raw = window.localStorage.getItem(TF_KEY);
    return isTimeframe(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

function writeTimeframe(value: Timeframe): void {
  try {
    window.localStorage.setItem(TF_KEY, value);
  } catch {
    // Not worth surfacing; the choice simply will not persist.
  }
  window.dispatchEvent(new CustomEvent(STORE_EVENT));
}

/**
 * The volume profile toggle, held for the session rather than for good.
 *
 * `sessionStorage`, not `localStorage`, and the difference is deliberate. The
 * requirement is that the choice survives switching tickers — it is a render
 * toggle over bars already in hand, so having it reset on every symbol change
 * would be pure friction. It is *not* a standing preference like the moving
 * averages are: the profile is a heavy overlay that covers a fifth of the
 * pane, and the sensible state to come back to tomorrow is off.
 *
 * Same event bus as the overlays, so one subscription serves all three stores.
 */
function readProfileEnabled(): boolean {
  try {
    return window.sessionStorage.getItem(PROFILE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeProfileEnabled(value: boolean): void {
  try {
    window.sessionStorage.setItem(PROFILE_KEY, value ? '1' : '0');
  } catch {
    // Storage can be unavailable; the event still syncs this session.
  }
  window.dispatchEvent(new CustomEvent(STORE_EVENT));
}

// --- indicator maths ---------------------------------------------------------

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Session-anchored VWAP.
 *
 * Resets whenever the New York calendar date changes, which is what makes it
 * VWAP rather than a running average over the whole window. Sessions are
 * identified with one `Intl` formatter reused across every bar — constructing
 * one per bar is the slow way to do this and shows up on a 5,000-bar series.
 */
function vwapSeries(bars: Bar[]): (number | null)[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const out: (number | null)[] = new Array(bars.length).fill(null);
  let day = '';
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const today = formatter.format(new Date(bar.t * 1000));
    if (today !== day) {
      day = today;
      cumulativePV = 0;
      cumulativeVolume = 0;
    }

    const typical = (bar.h + bar.l + bar.c) / 3;
    cumulativePV += typical * bar.v;
    cumulativeVolume += bar.v;

    // Some ETFs report no volume on some bars; without it VWAP is undefined
    // rather than zero.
    out[i] = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : null;
  }

  return out;
}

// --- component ---------------------------------------------------------------

interface SeriesResponse {
  symbol: string;
  timeframe: Timeframe;
  bars: Bar[];
  intraday: boolean;
  asOfLabel: string;
}

export function InteractiveChart({
  symbol,
  initialTimeframe = '5m',
  profileBuckets = DEFAULT_BUCKET_COUNT,
  profileLookback = null,
}: {
  symbol: string;
  initialTimeframe?: Timeframe;
  /** Price levels the volume profile is divided into. */
  profileBuckets?: number;
  /** Bars to profile, counting back from the newest in view. Null = the view. */
  profileLookback?: number | null;
}) {
  const overlays = useSyncExternalStore(
    subscribeStore,
    readOverlays,
    () => DEFAULT_OVERLAYS,
  );

  const timeframe = useSyncExternalStore(
    subscribeStore,
    () => readStoredTimeframe(initialTimeframe),
    () => initialTimeframe,
  );

  const profileOn = useSyncExternalStore(
    subscribeStore,
    readProfileEnabled,
    () => false,
  );

  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<Partial<Record<OverlayKey, { applyOptions: (o: object) => void }>>>({});
  const profileRef = useRef<VolumeProfilePrimitive | null>(null);

  /*
   * Derived, not tracked. Setting a `loading` flag at the top of the fetch
   * effect is a synchronous setState inside an effect — a cascading render for
   * something the data already tells us: whatever is in hand does not match
   * what was asked for.
   */
  const loading = !error && (data?.timeframe !== timeframe || data?.symbol !== symbol);

  // --- fetch ---
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

  // --- build ---
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
            // Intraday needs the clock; a daily series does not.
            timeVisible: data.intraday,
            secondsVisible: false,
          },
          crosshair: {
            vertLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
            horzLine: { color: COLOR.crosshair, labelBackgroundColor: '#1a2133' },
          },
          localization: { locale: 'en-US' },
          /*
           * The page has to stay scrollable through the chart.
           *
           * This is a stacked report, not a dedicated charting screen: a
           * 520px canvas that swallows the wheel traps a desktop reader
           * halfway down, and one that swallows a vertical swipe traps a
           * phone reader completely. Panning by drag and pinch-to-zoom both
           * still work, which is what people actually reach for here.
           */
          handleScroll: { vertTouchDrag: false, mouseWheel: false },
          handleScale: { mouseWheel: false },
        });

        // Strictly ascending, unique times: the library rejects anything else,
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

        /*
         * Volume profile, attached to the candles as a series primitive.
         *
         * Attached unconditionally and drawn only when enabled: the profile
         * needs the series' price scale to place its buckets, and attaching
         * and detaching on every toggle would mean tearing that binding down
         * and rebuilding it for something that is purely a question of whether
         * to paint. Disabled, it returns no renderer and costs nothing —
         * the buckets are not even computed.
         *
         * Read from the store rather than from React state for the same reason
         * the overlays are: this effect must not depend on the toggle, or
         * ticking the box would rebuild the entire chart. Bucket count and
         * lookback are applied by the effect below for the same reason, which
         * runs on this `data` before the browser paints.
         */
        const profile = new VolumeProfilePrimitive(PROFILE_COLOURS);
        profile.setBars(bars);
        profile.setEnabled(readProfileEnabled());
        candles.attachPrimitive(profile);
        profileRef.current = profile;

        const closes = bars.map((b) => b.c);
        // Read straight from the store rather than through a ref: this effect
        // must not depend on overlay state, or every toggle would rebuild the
        // whole chart instead of flipping a visibility flag.
        const current = readOverlays();
        seriesRef.current = {};

        for (const overlay of OVERLAYS) {
          const values = overlay.period
            ? ema(closes, overlay.period)
            : vwapSeries(bars);

          const points = values
            .map((value, i) => ({ time: bars[i].t as never, value }))
            .filter((p): p is { time: never; value: number } => p.value !== null);

          if (points.length === 0) continue;

          const usable = !overlay.intradayOnly || data.intraday;
          const line = chart.addSeries(LineSeries, {
            color: overlay.colour,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            lineStyle: overlay.key === 'vwap' ? LineStyle.Dashed : LineStyle.Solid,
            visible: usable && current[overlay.key],
          });
          line.setData(points);
          seriesRef.current[overlay.key] = line;
        }

        // --- RSI, in its own pane ---
        const rsiValues = rsi(closes, 14);
        const rsiPoints = rsiValues
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

          // Pinned so RSI cannot autoscale to a flat line in a quiet stretch.
          rsiSeries.applyOptions({
            autoscaleInfoProvider: () => ({
              priceRange: { minValue: 0, maxValue: 100 },
            }),
          });
          // Default margins pad a 0-100 range out to roughly 0-120, which
          // squeezes the 30-70 band nobody is looking away from.
          rsiSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.08, bottom: 0.08 },
          });

          const panes = chart.panes();
          if (panes.length > 1) panes[1].setHeight(110);
        }

        chart.timeScale().fitContent();
        cleanup = () => {
          seriesRef.current = {};
          profileRef.current = null;
          // `chart.remove()` disposes attached primitives with the series.
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
  }, [data]);

  // --- toggle without rebuilding ---
  useEffect(() => {
    for (const overlay of OVERLAYS) {
      const series = seriesRef.current[overlay.key];
      if (!series) continue;
      const usable = !overlay.intradayOnly || (data?.intraday ?? true);
      series.applyOptions({ visible: usable && overlays[overlay.key] });
    }
  }, [overlays, data]);

  // --- volume profile, likewise without rebuilding ---
  useEffect(() => {
    profileRef.current?.setOptions({
      bucketCount: profileBuckets,
      lookback: profileLookback,
    });
    profileRef.current?.setEnabled(profileOn);
  }, [profileOn, profileBuckets, profileLookback, data]);

  const toggle = (key: OverlayKey) => {
    writeOverlays({ ...overlays, [key]: !overlays[key] });
  };

  const chooseTimeframe = (tf: Timeframe) => writeTimeframe(tf);

  return (
    <figure className="panel p-0">
      {/* Controls. Wraps to two rows on a phone, tap targets stay ~36px. */}
      <figcaption className="space-y-2 border-b border-term-line px-3 py-2.5">
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
                onClick={() => chooseTimeframe(tf)}
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {OVERLAYS.map((overlay) => {
            const usable = !overlay.intradayOnly || (data?.intraday ?? true);
            return (
              <label
                key={overlay.key}
                className={`flex cursor-pointer items-center gap-1.5 py-1 text-2xs tracking-[0.08em] ${
                  usable ? 'text-term-dim' : 'cursor-not-allowed text-term-faint/50'
                }`}
                title={
                  usable
                    ? undefined
                    : 'VWAP resets each session, so it only applies to intraday timeframes.'
                }
              >
                <input
                  type="checkbox"
                  checked={usable && overlays[overlay.key]}
                  disabled={!usable}
                  onChange={() => toggle(overlay.key)}
                  className="h-3.5 w-3.5 shrink-0 accent-[#f0a500]"
                />
                <span
                  aria-hidden
                  className="h-0.5 w-3.5 shrink-0"
                  style={{
                    background: overlay.colour,
                    opacity: usable && overlays[overlay.key] ? 1 : 0.3,
                  }}
                />
                {overlay.label}
              </label>
            );
          })}

          {/*
            Separated from the moving averages because it is a different kind
            of thing: not a line derived per bar, but a histogram over the
            whole visible window.
          */}
          <label
            className="flex cursor-pointer items-center gap-1.5 border-l border-term-line py-1 pl-3 text-2xs tracking-[0.08em] text-term-dim"
            title="Volume by price, estimated from the bars already loaded. Toggling only changes what is drawn — nothing is refetched."
          >
            <input
              type="checkbox"
              checked={profileOn}
              onChange={() => writeProfileEnabled(!profileOn)}
              className="h-3.5 w-3.5 shrink-0 accent-[#f0a500]"
            />
            <span
              aria-hidden
              className="h-2.5 w-3.5 shrink-0"
              style={{
                background: PROFILE_COLOURS.valueArea,
                opacity: profileOn ? 1 : 0.3,
              }}
            />
            Volume profile
          </label>

          {profileOn && (
            <span className="flex items-center gap-1.5 py-1 text-2xs text-term-faint">
              <span
                aria-hidden
                className="h-0.5 w-3.5 shrink-0 border-t border-dashed"
                style={{ borderColor: POC_SWATCH }}
              />
              POC
            </span>
          )}
        </div>
      </figcaption>

      {error ? (
        <p className="px-3.5 py-10 text-center text-xs text-term-dim">{error}</p>
      ) : (
        <div
          ref={containerRef}
          className="h-[420px] w-full sm:h-[520px]"
          role="img"
          aria-label={`${symbol} ${timeframe} candlestick chart with moving averages and an RSI panel${
            profileOn ? ', and an estimated volume-by-price profile on the right edge' : ''
          }.`}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-term-line px-3 py-2 text-2xs text-term-faint">
        <span>
          <span className="text-flip">15-min delayed</span> · not live · RSI(14)
          with 30/70 marked
        </span>
        {data && <span className="tabular-nums">last bar {data.asOfLabel}</span>}
      </div>

      {/*
        Stated on the page, not just in the source. Someone reading a POC off
        this chart is reading a number that came out of an assumption, and they
        should be told which one before they trade against it.
      */}
      {profileOn && (
        <p className="border-t border-term-line px-3 py-2 text-2xs leading-relaxed text-term-faint">
          <span className="text-flip">Volume profile is an estimate.</span> These
          bars record only a high, a low and a session total — not the price each
          share actually traded at. Each bar&rsquo;s volume is therefore spread
          evenly across its range, so all the detail inside a bar comes from that
          rule rather than from the tape, and the shape leans toward wherever bars
          overlapped. It is closest to the truth on the fastest timeframes, where
          bars are narrow and the rule has little left to invent. Built from{' '}
          {profileLookback === null ? 'the visible range' : `${profileLookback} bars`}
          {' '}in {profileBuckets} price levels. No delta and no bid/ask split:
          bars cannot tell buying from selling, and a made-up number is worse than
          a missing one.
        </p>
      )}
    </figure>
  );
}
