import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

/**
 * Hand-drawn analysis tools — trendline, horizontal ray, Fibonacci retracement
 * — implemented as a single lightweight-charts *series primitive*.
 *
 * The reason it is a primitive rather than a second canvas laid over the chart
 * is the same reason the volume profile is (see `volumeProfileOverlay.ts`): the
 * primitive is handed the series' own `priceToCoordinate` and the chart's time
 * scale, so every anchor is placed by the exact scale the candles use. A line
 * drawn against its own price-to-pixel maths would drift the moment the chart
 * autoscaled or the reader panned, and would do it silently.
 *
 * Anchors are stored as `{ time, price }` — real data coordinates, not pixels —
 * so a drawing survives a pan, a zoom, a timeframe rebuild and a reload. The
 * cost of that durability is that a line is only drawn while both of its
 * anchors resolve to a coordinate: `timeToCoordinate` returns null for a time
 * scrolled off the left edge, and such a segment is skipped rather than guessed
 * at. A horizontal ray needs only its start's x and extends to the right edge,
 * so it is the most robust of the three.
 */

// --- model -------------------------------------------------------------------

export type DrawingTool = 'trendline' | 'ray' | 'fib';

/** A single anchor in data space — never pixels. */
export interface Anchor {
  time: Time;
  price: number;
}

export interface Drawing {
  id: string;
  tool: DrawingTool;
  /** Two anchors for every tool; the ray ignores the second's time. */
  a: Anchor;
  b: Anchor;
}

/** The classic retracement grid. Level is the fraction from A (0) to B (1). */
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const COLOR = {
  trendline: '#4c8dff',
  ray: '#f0a500',
  fib: '#a78bfa',
  fibText: '#c8d6e5',
  draft: '#8494a8',
  handle: '#c8d6e5',
};

/** Fib bands, faint enough to read price through. Index-aligned to FIB_LEVELS. */
const FIB_FILLS = [
  'rgba(167, 139, 250, 0.00)',
  'rgba(167, 139, 250, 0.06)',
  'rgba(167, 139, 250, 0.08)',
  'rgba(167, 139, 250, 0.10)',
  'rgba(167, 139, 250, 0.08)',
  'rgba(167, 139, 250, 0.06)',
  'rgba(167, 139, 250, 0.00)',
];

// --- renderer ----------------------------------------------------------------

/*
 * Fields are assigned in the body rather than as constructor parameter
 * properties: `node --experimental-strip-types` runs the repo's verify scripts
 * straight off the TypeScript and rejects parameter properties, the one common
 * syntax that emits code rather than only erasing types. Same rule as the
 * volume-profile primitive next door.
 */
class DrawingRenderer implements IPrimitivePaneRenderer {
  private readonly source: DrawingPrimitive;

  public constructor(source: DrawingPrimitive) {
    this.source = source;
  }

  public draw(target: CanvasRenderingTarget2D): void {
    const chart = this.source.chart;
    const series = this.source.series;
    if (!chart || !series) return;
    const timeScale = chart.timeScale();

    target.useBitmapCoordinateSpace((scope) => {
      const {
        context: ctx,
        bitmapSize,
        horizontalPixelRatio: hRatio,
        verticalPixelRatio: vRatio,
      } = scope;

      /** Anchor to device pixels, or null when it is off the time axis. */
      const project = (anchor: Anchor): { x: number; y: number } | null => {
        const x = timeScale.timeToCoordinate(anchor.time);
        const y = series.priceToCoordinate(anchor.price);
        if (x === null || y === null) return null;
        return { x: x * hRatio, y: y * vRatio };
      };

      const drawings = [...this.source.drawings];
      const draft = this.source.draft;
      if (draft) drawings.push(draft);

      for (const d of drawings) {
        const a = project(d.a);
        if (!a) continue;

        if (d.tool === 'ray') {
          // A horizontal ray needs only its anchor price and extends to the
          // right edge, so it draws even when its start time is off-screen as
          // long as the price resolves.
          ctx.beginPath();
          ctx.strokeStyle = COLOR.ray;
          ctx.lineWidth = Math.max(1, Math.round(1.5 * vRatio));
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(bitmapSize.width, a.y);
          ctx.stroke();
          this.handle(ctx, a.x, a.y, vRatio);
          continue;
        }

        const b = project(d.b);
        if (!b) continue;

        if (d.tool === 'trendline') {
          ctx.beginPath();
          ctx.strokeStyle = d === draft ? COLOR.draft : COLOR.trendline;
          ctx.lineWidth = Math.max(1, Math.round(1.5 * vRatio));
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          this.handle(ctx, a.x, a.y, vRatio);
          this.handle(ctx, b.x, b.y, vRatio);
          continue;
        }

        // --- fibonacci retracement ---
        // A and B set the price range; levels are drawn as horizontals across
        // the span between the two anchors' x, each labelled with its ratio and
        // the price it lands on.
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.x, b.x);
        const priceHigh = d.a.price; // level 0 sits at anchor A
        const priceLow = d.b.price; // level 1 sits at anchor B
        const yAt = (price: number): number | null => {
          const c = series.priceToCoordinate(price);
          return c === null ? null : c * vRatio;
        };

        // Bands first, so the level lines sit on top of their fills.
        for (let i = 0; i < FIB_LEVELS.length - 1; i += 1) {
          const p1 = priceHigh + (priceLow - priceHigh) * FIB_LEVELS[i];
          const p2 = priceHigh + (priceLow - priceHigh) * FIB_LEVELS[i + 1];
          const y1 = yAt(p1);
          const y2 = yAt(p2);
          if (y1 === null || y2 === null) continue;
          ctx.fillStyle = FIB_FILLS[i];
          ctx.fillRect(left, Math.min(y1, y2), right - left, Math.abs(y2 - y1));
        }

        ctx.lineWidth = Math.max(1, Math.round(1 * vRatio));
        ctx.font = `${Math.round(10 * vRatio)}px ui-monospace, monospace`;
        ctx.textBaseline = 'middle';
        for (const level of FIB_LEVELS) {
          const price = priceHigh + (priceLow - priceHigh) * level;
          const y = yAt(price);
          if (y === null) continue;
          ctx.beginPath();
          ctx.strokeStyle = d === draft ? COLOR.draft : COLOR.fib;
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.fillStyle = COLOR.fibText;
          ctx.fillText(
            `${level.toFixed(3)}  ${price.toFixed(2)}`,
            right + 4 * hRatio,
            y,
          );
        }
        this.handle(ctx, a.x, a.y, vRatio);
        this.handle(ctx, b.x, b.y, vRatio);
      }
    });
  }

  /** A small square knob at an anchor, so a placed point reads as grab-able. */
  private handle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    vRatio: number,
  ): void {
    const s = Math.round(3 * vRatio);
    ctx.fillStyle = COLOR.handle;
    ctx.fillRect(x - s, y - s, s * 2, s * 2);
  }
}

// --- pane view ---------------------------------------------------------------

class DrawingPaneView implements IPrimitivePaneView {
  private readonly paneRenderer: DrawingRenderer;

  public constructor(source: DrawingPrimitive) {
    this.paneRenderer = new DrawingRenderer(source);
  }

  public renderer(): IPrimitivePaneRenderer {
    return this.paneRenderer;
  }
}

// --- primitive ---------------------------------------------------------------

/**
 * The attachable object. Holds the committed drawings plus one in-progress
 * draft, exposes the chart/series the renderer needs, and requests a repaint
 * whenever any of that changes.
 */
export class DrawingPrimitive implements ISeriesPrimitive<Time> {
  public chart: IChartApiBase<Time> | null = null;
  public series: ISeriesApi<SeriesType, Time> | null = null;
  public drawings: Drawing[] = [];
  public draft: Drawing | null = null;

  private readonly view: DrawingPaneView;
  private requestUpdate?: () => void;

  public constructor() {
    this.view = new DrawingPaneView(this);
  }

  public attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<SeriesType, Time>;
    this.requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** Replace the committed set — e.g. when restoring from storage. */
  public setDrawings(drawings: Drawing[]): void {
    this.drawings = drawings;
    this.requestUpdate?.();
  }

  public setDraft(draft: Drawing | null): void {
    this.draft = draft;
    this.requestUpdate?.();
  }
}
