'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isTimeframe, TIMEFRAMES, type Timeframe } from '@/lib/bars/types';
import { ema, rsi } from '@/lib/ticker/indicators';
import { InfoTip } from './InfoTip';
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
  /* The gamma flip's own tone — the purple the strike profile already uses. */
  level: '#a78bfa',
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

/** The price-pane line overlays, plus RSI, which renders in its own pane. */
export type OverlayKey = 'ema9' | 'ema13' | 'ema50' | 'ema200' | 'vwap' | 'rsi';

interface Overlay {
  key: OverlayKey;
  label: string;
  colour: string;
  period?: number;
  /** VWAP is meaningless above 15 minutes; it resets every session. */
  intradayOnly?: boolean;
}

/** The moving-average and VWAP lines drawn on the price pane. */
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
  ema50: false,
  ema200: false,
  vwap: true,
  rsi: false,
};

/** Every toggle key, in the order the store validates them. */
const OVERLAY_KEYS: OverlayKey[] = ['ema9', 'ema13', 'ema50', 'ema200', 'vwap', 'rsi'];

/**
 * VWAP only means something intraday, and only below an hour: on a 1h or 4h
 * series each bar already spans a large slice of the session, so a running
 * session average is noise. The toggle is hidden entirely above 15 minutes
 * rather than shown disabled.
 */
function vwapApplies(timeframe: Timeframe): boolean {
  return timeframe === '1m' || timeframe === '5m' || timeframe === '15m';
}

const OVERLAY_KEY = 'gammadesk.chart.overlays';
const TF_KEY = 'gammadesk.chart.timeframe';
const PROFILE_KEY = 'gammadesk.chart.volumeProfile';
const LEVELS_KEY = 'gammadesk.chart.levels';
const STORE_EVENT = 'gammadesk:chart';

/** Sessions shown when the chart first loads, and after a symbol change. */
const INITIAL_SESSIONS = 5;
/** Levels farther than this from spot are hidden — they are not in play. */
const LEVEL_RANGE_PCT = 8;

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
      for (const key of OVERLAY_KEYS) {
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

/**
 * The gamma-level overlay toggle, a standing preference like the moving
 * averages — so `localStorage`, and on by default. Same event bus as the rest.
 */
function readLevelsEnabled(): boolean {
  try {
    // On unless explicitly turned off, so a first-time reader sees the levels.
    return window.localStorage.getItem(LEVELS_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeLevelsEnabled(value: boolean): void {
  try {
    window.localStorage.setItem(LEVELS_KEY, value ? '1' : '0');
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

/**
 * The epoch-seconds start of the window covering the last `sessions` New York
 * calendar dates in `bars`, or null when there are none. Used to open the chart
 * on the most recent few sessions rather than the whole fetched month.
 */
function lastSessionsFrom(bars: Bar[], sessions: number): number | null {
  if (bars.length === 0) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const seen = new Set<string>();
  // Walk newest-first, collecting distinct session dates until we have enough;
  // the first bar of the oldest kept date is where the window starts.
  let start = bars[0].t;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const date = formatter.format(new Date(bars[i].t * 1000));
    if (!seen.has(date)) {
      if (seen.size >= sessions) break;
      seen.add(date);
    }
    start = bars[i].t;
  }
  return start;
}

// --- component ---------------------------------------------------------------

interface SeriesResponse {
  symbol: string;
  timeframe: Timeframe;
  bars: Bar[];
  intraday: boolean;
  asOfLabel: string;
}

/**
 * A gamma level to draw as a flat horizontal line across the chart.
 *
 * One value per level for the whole window, from the latest daily snapshot —
 * these are today's book, not a per-bar history. `kind` decides the tone: the
 * flip gets its own colour, the walls share a neutral one, and nothing here
 * implies a direction to trade.
 */
export interface ChartLevel {
  key: string;
  /** Plain name shown at the right edge, e.g. `Call wall`. */
  name: string;
  price: number;
  kind: 'flip' | 'wall';
  /** One plain-English sentence for the legend tooltip. No jargon. */
  plain: string;
}

export function InteractiveChart({
  symbol,
  initialTimeframe = '15m',
  levels = [],
  spot = null,
  profileBuckets = DEFAULT_BUCKET_COUNT,
  profileLookback = null,
}: {
  symbol: string;
  initialTimeframe?: Timeframe;
  /** Gamma levels from today's snapshot, drawn as flat lines when in range. */
  levels?: ChartLevel[];
  /** Spot the levels are measured against, so far-off ones can be hidden. */
  spot?: number | null;
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

  const levelsOn = useSyncExternalStore(
    subscribeStore,
    readLevelsEnabled,
    () => true,
  );

  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** EMAs the fetched history was too short to warm up, by label. */
  const [unavailableEmas, setUnavailableEmas] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<Partial<Record<OverlayKey, { applyOptions: (o: object) => void }>>>({});
  const profileRef = useRef<VolumeProfilePrimitive | null>(null);

  /*
   * The visible time window, remembered across rebuilds.
   *
   * Switching timeframe refetches and rebuilds the chart, and the requirement
   * is that the window you were looking at does not jump — a 5-session view on
   * 15m stays a 5-session view when you move to 1h. So the range is captured as
   * the user pans and reapplied after each rebuild. It is cleared on a symbol
   * change (below), which is the one case that should reset to the last few
   * sessions of the new ticker rather than reuse the old one's window.
   */
  const visibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const builtSymbolRef = useRef<string | null>(null);

  /*
   * Derived, not tracked. Setting a `loading` flag at the top of the fetch
   * effect is a synchronous setState inside an effect — a cascading render for
   * something the data already tells us: whatever is in hand does not match
   * what was asked for.
   */
  const loading = !error && (data?.timeframe !== timeframe || data?.symbol !== symbol);

  /*
   * A stable key for the level set, so the build effect rebuilds when the
   * levels themselves change but not on every parent render that happens to
   * hand down a fresh array of the same values.
   */
  const levelsKey = JSON.stringify(levels.map((l) => [l.key, l.price]));

  /*
   * The levels actually drawn: those within range of spot. Kept in sync with
   * the same test the build effect uses, so the legend never lists a line that
   * is not on the chart.
   */
  const visibleLevels = levels.filter(
    (l) =>
      spot === null ||
      !(spot > 0) ||
      Math.abs((l.price - spot) / spot) * 100 <= LEVEL_RANGE_PCT,
  );

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
        // must not depend on the EMA/VWAP toggles, or ticking one would rebuild
        // the whole chart instead of flipping a visibility flag.
        const current = readOverlays();
        const vwapUsable = vwapApplies(data.timeframe);
        seriesRef.current = {};

        /*
         * EMAs are computed over the whole fetched series, not just the
         * sessions on screen, so by the time the visible window begins each
         * average is already warmed up from the bars before it. The only line
         * that genuinely cannot be drawn is one whose period is longer than the
         * entire history available — and that one is hidden and named below,
         * rather than drawn from a half-formed average.
         */
        const unavailable: string[] = [];

        for (const overlay of OVERLAYS) {
          const values = overlay.period
            ? ema(closes, overlay.period)
            : vwapSeries(bars);

          const points = values
            .map((value, i) => ({ time: bars[i].t as never, value }))
            .filter((p): p is { time: never; value: number } => p.value !== null);

          // A moving average with no defined point is one the history is too
          // short to warm up. VWAP producing nothing is not that — it is a
          // volumeless series — so only the EMAs are named as missing.
          if (points.length === 0) {
            if (overlay.period && current[overlay.key]) unavailable.push(overlay.label);
            continue;
          }

          const usable = overlay.key === 'vwap' ? vwapUsable : true;
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

        setUnavailableEmas(unavailable);

        // --- RSI, in its own pane, only when it is turned on ---
        // Built conditionally so the pane simply does not exist when RSI is
        // off and the price chart keeps the full height. Toggling RSI is in
        // this effect's deps, so flipping it rebuilds — the visible window is
        // restored below, so the rebuild is not visible as a jump.
        if (current.rsi) {
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
        }

        // --- gamma levels, as flat lines from today's snapshot ---
        // Only those within range of spot; a wall 20% away is not in play and
        // would only compress the price scale. The walls share a neutral tone
        // and the flip gets its own, so nothing here reads as a buy or sell.
        if (levelsOn) {
          for (const level of levels) {
            if (
              spot !== null &&
              spot > 0 &&
              Math.abs((level.price - spot) / spot) * 100 > LEVEL_RANGE_PCT
            ) {
              continue;
            }
            candles.createPriceLine({
              price: level.price,
              color: level.kind === 'flip' ? COLOR.level : COLOR.vwap,
              lineWidth: 1,
              lineStyle: level.kind === 'flip' ? LineStyle.Dashed : LineStyle.Solid,
              axisLabelVisible: true,
              title: level.name,
            });
          }
        }

        // --- the visible window ---
        // A symbol change opens on the last few sessions of the new ticker; a
        // timeframe change keeps whatever window was on screen. See the ref.
        const timeScale = chart.timeScale();
        if (builtSymbolRef.current !== data.symbol) {
          visibleRangeRef.current = null;
          builtSymbolRef.current = data.symbol;
        }

        const restore = visibleRangeRef.current;
        if (restore) {
          timeScale.setVisibleRange({ from: restore.from as never, to: restore.to as never });
        } else {
          const from = lastSessionsFrom(bars, INITIAL_SESSIONS);
          if (from !== null) {
            timeScale.setVisibleRange({
              from: from as never,
              to: bars[bars.length - 1].t as never,
            });
          } else {
            timeScale.fitContent();
          }
        }

        // Remember the window as the reader pans or zooms, so the next
        // timeframe switch reopens on it rather than resetting.
        const onRange = (range: { from: number; to: number } | null) => {
          if (range) visibleRangeRef.current = { from: range.from, to: range.to };
        };
        timeScale.subscribeVisibleTimeRangeChange(onRange as never);

        cleanup = () => {
          seriesRef.current = {};
          profileRef.current = null;
          timeScale.unsubscribeVisibleTimeRangeChange(onRange as never);
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
    // RSI, the levels and the levels toggle change the chart's structure — a
    // pane, or a set of price lines — so they rebuild. The EMA/VWAP toggles do
    // not: they only flip a line's visibility, handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, overlays.rsi, levelsOn, levelsKey, spot]);

  // --- toggle the moving averages without rebuilding ---
  useEffect(() => {
    for (const overlay of OVERLAYS) {
      const series = seriesRef.current[overlay.key];
      if (!series) continue;
      const usable = overlay.key === 'vwap' ? vwapApplies(timeframe) : true;
      series.applyOptions({ visible: usable && overlays[overlay.key] });
    }
  }, [overlays, timeframe]);

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
            // VWAP is hidden entirely above 15 minutes rather than shown
            // disabled — a running session average is meaningless there.
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

          {/*
            RSI is a toggle like the moving averages, but it draws in its own
            pane below price rather than as a line over it — so it sits with
            them here, and turning it on rebuilds to make room for the pane.
          */}
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

          {/*
            The gamma levels toggle. On by default, and its own standing
            preference — so it is grouped apart from the price-derived overlays.
          */}
          {levels.length > 0 && (
            <label
              className="flex cursor-pointer items-center gap-1.5 border-l border-term-line py-1 pl-3 text-2xs tracking-[0.08em] text-term-dim"
              title="Gamma levels from today's option snapshot, drawn as flat lines. Toggling only changes what is drawn."
            >
              <input
                type="checkbox"
                checked={levelsOn}
                onChange={() => writeLevelsEnabled(!levelsOn)}
                className="h-3.5 w-3.5 shrink-0 accent-[#f0a500]"
              />
              <span
                aria-hidden
                className="h-0.5 w-3.5 shrink-0"
                style={{ background: COLOR.level, opacity: levelsOn ? 1 : 0.3 }}
              />
              Gamma levels
            </label>
          )}

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

        {/*
          The level key, with a plain-English line on each. It doubles as the
          place the level tooltips live, since a price line drawn on the canvas
          has nowhere to hang one.
        */}
        {levelsOn && visibleLevels.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-term-line pt-1.5 text-2xs text-term-faint">
            {visibleLevels.map((level) => (
              <span key={level.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-0.5 w-3.5 shrink-0"
                  style={{
                    background: level.kind === 'flip' ? COLOR.level : COLOR.vwap,
                  }}
                />
                {level.name}
                <InfoTip tip={{ label: level.name, plain: level.plain }} />
              </span>
            ))}
          </div>
        )}

        {/*
          A moving average the fetched history was too short to warm up is
          hidden rather than drawn from a half-formed average — and said here,
          so its empty toggle does not read as a bug.
        */}
        {unavailableEmas.length > 0 && (
          <p className="border-t border-term-line pt-1.5 text-2xs leading-relaxed text-term-faint">
            Not enough history on this timeframe to draw the{' '}
            {unavailableEmas.join(' or the ')} yet, so {unavailableEmas.length > 1 ? 'they are' : 'it is'}{' '}
            hidden rather than shown half-formed.
          </p>
        )}
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
          {levelsOn && visibleLevels.length > 0 && ' · levels are from today’s snapshot'}
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
