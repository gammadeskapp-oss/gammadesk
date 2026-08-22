import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { buildVolumeProfile, DEFAULT_BUCKET_COUNT } from '@/lib/profile';
import type { VolumeProfile } from '@/lib/profile';

/**
 * Draws a volume profile down the right-hand edge of the price pane.
 *
 * Implemented as a lightweight-charts *series primitive* — the library's own
 * extension point — rather than a second canvas laid over the chart. That
 * matters for one reason: the primitive is handed the series' own
 * `priceToCoordinate`, so every bucket is positioned by the same price scale
 * the candles use. An overlay that did its own price-to-pixel maths would
 * drift out of alignment the moment the scale autoscaled, and would do it
 * silently.
 *
 * The maths lives in `@/lib/profile` and is pure. This file is only drawing,
 * plus the bookkeeping to decide which bars are in view.
 *
 * On what the picture actually means, see the note at the top of
 * `@/lib/profile/volumeProfile` — the short version is that bars do not record
 * where inside their range the volume traded, so the horizontal extent of
 * every bucket here is the product of a spreading rule, not an observation.
 */

/** A bar with the time the chart indexes it by. */
export interface ProfileSourceBar {
  t: number;
  h: number;
  l: number;
  v: number;
}

export interface VolumeProfileColours {
  /** Buckets outside the value area. */
  bucket: string;
  /** Buckets inside it. */
  valueArea: string;
  /** Wash behind the value area, marking its price extent across the band. */
  valueAreaFill: string;
  /** The point of control: its bucket, and the line across the pane. */
  poc: string;
}

export interface VolumeProfileOptions {
  bucketCount: number;
  /**
   * Widest bucket, as a fraction of the pane width.
   *
   * The profile shares the pane with the candles it describes, so it is capped
   * well short of covering them and drawn translucent on top.
   */
  widthFraction: number;
  /**
   * Bars to profile, counting back from the most recent bar in view.
   *
   * Null means the visible range itself, which is the default: the profile
   * then describes exactly the stretch of chart being looked at, and re-derives
   * as it is panned or zoomed.
   */
  lookback: number | null;
  colours: VolumeProfileColours;
}

export const DEFAULT_PROFILE_OPTIONS: Omit<VolumeProfileOptions, 'colours'> = {
  bucketCount: DEFAULT_BUCKET_COUNT,
  widthFraction: 0.22,
  lookback: null,
};

/** Pixel gap between adjacent buckets, so the histogram reads as bars. */
const BUCKET_GAP = 1;

/** A bucket thinner than this is drawn solid; below it the gap eats the bar. */
const MIN_BUCKET_HEIGHT = 2;

/**
 * Clear space, in CSS pixels, between the heaviest bucket and the price axis.
 *
 * Without it the longest bar runs flush to the edge of the pane and reads as
 * clipped by the axis rather than as ending — the profile's single loudest
 * feature then looks like a rendering fault.
 */
const AXIS_GAP = 6;

// --- renderer ----------------------------------------------------------------

class VolumeProfileRenderer implements IPrimitivePaneRenderer {
  /*
   * Fields are assigned in the body rather than declared as constructor
   * parameter properties, here and below. That is not a style preference:
   * `node --experimental-strip-types` runs the repo's verify scripts straight
   * off the TypeScript, and parameter properties are the one common syntax it
   * refuses, because they emit code rather than only erase types.
   */
  private readonly source: VolumeProfilePrimitive;
  private readonly profile: VolumeProfile | null;

  public constructor(source: VolumeProfilePrimitive, profile: VolumeProfile | null) {
    this.source = source;
    this.profile = profile;
  }

  public draw(target: CanvasRenderingTarget2D): void {
    const profile = this.profile;
    const series = this.source.series;
    if (!profile || !series || profile.maxBucketVolume <= 0) return;

    const { colours, widthFraction } = this.source.options;

    /*
     * Bitmap space rather than media space: the bucket separators and the POC
     * line are hairlines, and rounding them to whole device pixels is the
     * difference between a crisp rule and a grey smear on a 2x display.
     */
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, horizontalPixelRatio: hRatio, verticalPixelRatio: vRatio } =
        scope;

      /*
       * Everything is drawn against `right`, not against the pane edge, and
       * every width is clamped to `maxWidth`. The clamp is belt and braces —
       * a bucket cannot exceed the maximum it is scaled against — but the
       * scaling divides by a cached figure, and a stale or non-finite one
       * would otherwise paint a bar straight across the chart.
       */
      const right = bitmapSize.width - AXIS_GAP * hRatio;
      const maxWidth = Math.min(bitmapSize.width * widthFraction, right);
      if (maxWidth <= 0 || !Number.isFinite(profile.maxBucketVolume)) return;

      /** Bucket volume to a bar width that can never cross `right`. */
      const widthFor = (volume: number): number => {
        const scaled = (volume / profile.maxBucketVolume) * maxWidth;
        if (!Number.isFinite(scaled)) return 0;
        return Math.max(0, Math.min(maxWidth, scaled));
      };

      /** Price to device pixels, through the series' own scale. */
      const y = (price: number): number | null => {
        const coordinate = series.priceToCoordinate(price);
        return coordinate === null ? null : coordinate * vRatio;
      };

      ctx.save();

      // --- value area wash, behind the bars ---
      const va = profile.valueArea;
      if (va) {
        const top = y(va.high);
        const bottom = y(va.low);
        if (top !== null && bottom !== null) {
          ctx.fillStyle = colours.valueAreaFill;
          ctx.fillRect(right - maxWidth, top, maxWidth, bottom - top);
        }
      }

      // --- buckets ---
      for (let i = 0; i < profile.buckets.length; i += 1) {
        const bucket = profile.buckets[i];
        if (bucket.volume <= 0) continue;

        const top = y(bucket.priceHigh);
        const bottom = y(bucket.priceLow);
        if (top === null || bottom === null) continue;

        const full = bottom - top;
        if (full <= 0) continue;

        // Keep the gap only while there is enough height to spare one; on a
        // squeezed scale a gapped profile turns into a dashed blur.
        const gap = full > MIN_BUCKET_HEIGHT + BUCKET_GAP * vRatio ? BUCKET_GAP * vRatio : 0;
        const height = Math.max(1, full - gap);

        const width = widthFor(bucket.volume);
        if (width < 1) continue;

        ctx.fillStyle =
          i === profile.pocIndex
            ? colours.poc
            : va && i >= va.fromIndex && i <= va.toIndex
              ? colours.valueArea
              : colours.bucket;

        const x = Math.round(right - width);
        ctx.fillRect(x, Math.round(top), Math.round(right) - x, Math.round(height));
      }

      // --- the POC, across the whole pane ---
      // Drawn full width rather than only across the band: the price it names
      // is the one worth reading against the candles on the left.
      if (profile.pocIndex !== null) {
        const bucket = profile.buckets[profile.pocIndex];
        const mid = y((bucket.priceLow + bucket.priceHigh) / 2);
        if (mid !== null) {
          ctx.strokeStyle = colours.poc;
          ctx.lineWidth = Math.max(1, Math.round(vRatio));
          ctx.setLineDash([4 * hRatio, 3 * hRatio]);
          ctx.beginPath();
          const line = Math.round(mid) + 0.5;
          ctx.moveTo(0, line);
          ctx.lineTo(right, line);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      ctx.restore();
    });
  }
}

// --- pane view ---------------------------------------------------------------

class VolumeProfilePaneView implements IPrimitivePaneView {
  private readonly source: VolumeProfilePrimitive;

  public constructor(source: VolumeProfilePrimitive) {
    this.source = source;
  }

  /*
   * Beneath the series, and that is the whole fix for the profile hiding
   * price action.
   *
   * The pane has no right margin worth drawing into — the time scale reserves
   * `rightOffset` bars of empty space, which at the bar spacing `fitContent`
   * produces here is a couple of pixels, not the fifth of a pane a histogram
   * needs. So the profile has to share space with the candles, and the only
   * question is which one wins where they meet.
   *
   * Drawing underneath answers it without compromise: candles paint over the
   * buckets at full strength, so nothing is read through a haze, while the
   * profile still shows in every gap between wicks and everywhere price has
   * not been. Lowering the bucket opacity alone would have dimmed the candles
   * *and* the profile to make one legible through the other; this dims
   * neither.
   *
   * The POC line and the value-area wash go under the candles too, but both
   * span the full width of the pane and the candles covering them are a few
   * pixels wide, so both stay plainly visible.
   */
  public zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  public renderer(): IPrimitivePaneRenderer | null {
    if (!this.source.enabled) return null;
    return new VolumeProfileRenderer(this.source, this.source.currentProfile());
  }
}

// --- primitive ---------------------------------------------------------------

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  public series: ISeriesApi<SeriesType, Time> | null = null;
  private chart: IChartApiBase<Time> | null = null;
  public enabled = false;
  public options: VolumeProfileOptions;

  private readonly views: IPrimitivePaneView[] = [new VolumeProfilePaneView(this)];
  private bars: readonly ProfileSourceBar[] = [];
  private requestUpdate: (() => void) | null = null;

  /*
   * The profile is cached against the window it was built from. Panning fires
   * `updateAllViews` continuously, and rebuilding 50 buckets from several
   * thousand bars on every frame of a drag is work with nothing to show for it
   * whenever the window has not actually moved.
   */
  private cached: VolumeProfile | null = null;
  private cacheKey = '';

  public constructor(colours: VolumeProfileColours, overrides: Partial<VolumeProfileOptions> = {}) {
    this.options = { ...DEFAULT_PROFILE_OPTIONS, colours, ...overrides };
  }

  // --- lifecycle ---

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
    this.invalidate();
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** Called by the library whenever the viewport moves. */
  public updateAllViews(): void {
    // Nothing to do eagerly: `currentProfile` rebuilds only when the window
    // it depends on has changed.
  }

  // --- inputs ---

  public setBars(bars: readonly ProfileSourceBar[]): void {
    this.bars = bars;
    this.invalidate();
    this.redraw();
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.redraw();
  }

  public setOptions(overrides: Partial<VolumeProfileOptions>): void {
    this.options = { ...this.options, ...overrides };
    this.invalidate();
    this.redraw();
  }

  /** The profile as last drawn, for the legend. Null when there is nothing. */
  public currentProfile(): VolumeProfile | null {
    if (!this.series || this.bars.length === 0) return null;

    const window = this.visibleBars();
    if (window.bars.length === 0) return null;

    const key = `${window.key}|${this.options.bucketCount}|${this.options.lookback ?? 'visible'}`;
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.cached = buildVolumeProfile(window.bars, { bucketCount: this.options.bucketCount });
    }
    return this.cached;
  }

  // --- internals ---

  /**
   * The bars the profile covers.
   *
   * By default that is whatever the time scale is showing, so the profile
   * always describes the stretch on screen. A fixed `lookback` instead counts
   * back from the newest bar in view, which keeps the sample size steady while
   * panning.
   *
   * Falls back to the whole series when the time scale has no range to report
   * — during the first frame after a rebuild, mostly. Profiling everything is
   * a worse answer than profiling the view, but it is a much better one than
   * drawing nothing.
   */
  private visibleBars(): {
    bars: readonly ProfileSourceBar[];
    key: string;
  } {
    const range = this.chartTimeRange();

    let visible = this.bars;
    if (range) {
      visible = this.bars.filter((bar) => bar.t >= range.from && bar.t <= range.to);
    }
    if (visible.length === 0) visible = this.bars;

    const lookback = this.options.lookback;
    if (lookback !== null && lookback > 0 && visible.length > lookback) {
      visible = visible.slice(visible.length - lookback);
    }

    const first = visible[0];
    const last = visible[visible.length - 1];
    return {
      bars: visible,
      key: `${first?.t ?? 0}:${last?.t ?? 0}:${visible.length}`,
    };
  }

  /** Visible time range in epoch seconds, or null when unavailable. */
  private chartTimeRange(): { from: number; to: number } | null {
    const range = this.chart?.timeScale().getVisibleRange();
    if (!range) return null;
    // Our series is stamped with epoch seconds, so `Time` is a number here.
    const from = Number(range.from);
    const to = Number(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return { from, to };
  }

  private invalidate(): void {
    this.cacheKey = '';
    this.cached = null;
  }

  private redraw(): void {
    this.requestUpdate?.();
  }
}
