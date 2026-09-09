/**
 * Shapes and tunables for the episodic-pivot scanner on /lab.
 *
 * Client-safe and free of `server-only`: the board, the controls and the chart
 * all render in the browser and read these labels and defaults, so a second
 * hand-written copy would eventually describe a different scan from the one the
 * server ran. The scan itself is a pure function in `./scan.ts`; the fetch,
 * universe and store plumbing live in `./bars.ts`, `./universe.ts` and
 * `./refresh.ts`, which are the only files here allowed to touch the network or
 * a store.
 *
 * ## What this scanner is, and what it deliberately is not
 *
 * It finds stocks that were flat and ignored and then gapped up hard on heavy
 * volume — an "episodic pivot" — and then tracks what each name has done since
 * the gap. It is a **watchlist builder, not an entry signal**, and every
 * surface that renders it says so. There is no buy/sell language, no alert, no
 * outcome log and no fixed daily count: it shows whatever qualifies on the day,
 * including nothing.
 *
 * ## Two threshold sets: capture and display
 *
 * The scan is expensive — a daily-bar pull across the whole common-stock
 * universe — and like everything else on /lab it is a stored document a page
 * view reads rather than recomputes. That means the thresholds cannot be truly
 * live: a slider that loosened the gap floor would need names the scan never
 * kept. So the scan runs at a *capture* envelope, wider than the shipped
 * defaults, and stores every survivor together with the raw numbers behind it.
 * The UI then applies the *display* thresholds — defaulting to the spec values
 * below — over those stored numbers entirely client-side, and can tighten
 * freely or loosen down to the capture floor. Going wider than the capture
 * floor is the one thing the page cannot do without a re-scan, and it says so.
 */

/** Bumped whenever the stored document's shape changes, so an old one is ignored. */
export const EPISODIC_SCHEMA = 1;

/** One daily OHLCV bar, as the stored finding carries it for the row chart. */
export interface EpisodicBar {
  /** `YYYY-MM-DD`, New York session date. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- the adjustable thresholds ----------------------------------------------

/**
 * The thresholds a reader can move in the UI. Every one has a shipped default
 * below and a capture floor the scan stored down to; the control clamps to
 * `[capture, strict]` so the page can only ever tighten past what was scanned.
 */
export interface EpisodicParams {
  /** Minimum gap, open vs prior close, as a fraction. Default 0.05 (5%). */
  gapMinPct: number;
  /** Gap-day volume as a multiple of the 50-day average. Default 5. */
  volumeMult: number;
  /** Minimum gap-day dollar volume (close × shares). Default 20_000_000. */
  dollarMin: number;
  /** Widest the 60-session base may be, (highest high − lowest low) / low. Default 0.25. */
  baseRangeMax: number;
}

/** The shipped defaults — the spec's numbers, and where every control opens. */
export const EPISODIC_DEFAULTS: EpisodicParams = {
  gapMinPct: 0.05,
  volumeMult: 5,
  dollarMin: 20_000_000,
  baseRangeMax: 0.25,
};

/**
 * The capture envelope: the loosest the scan will keep. Wider than the defaults
 * so the display sliders have somewhere to loosen to, but not so wide that the
 * stored document fills with noise. A reader who wants a genuinely wider net
 * than this has to re-run the scan, because the names below it were never kept.
 */
export const EPISODIC_CAPTURE: EpisodicParams = {
  gapMinPct: 0.04,
  volumeMult: 3.5,
  dollarMin: 12_000_000,
  baseRangeMax: 0.32,
};

/**
 * The strict end of every slider, so tightening has a stop too. Note that for
 * `baseRangeMax`, *lower* is stricter — a quieter base — so its strict value is
 * the small number and the capture floor above is the loose one. The board
 * reads the direction per field rather than assuming strict is always larger.
 */
export const EPISODIC_STRICT: EpisodicParams = {
  gapMinPct: 0.15,
  volumeMult: 15,
  dollarMin: 100_000_000,
  baseRangeMax: 0.1,
};

// --- fixed universe filters (not slider-adjustable) --------------------------

/**
 * Liquidity floor for the universe. A name below either bar is not scanned at
 * all — it is neither tradeable nor the sort of thing an episodic pivot is
 * looking for. These are the spec's fixed universe rules, not the adjustable
 * pattern thresholds, so they live apart from `EpisodicParams`.
 */
export const UNIVERSE_MIN_PRICE = 5;
export const UNIVERSE_MIN_AVG_VOLUME = 500_000;

/** Sessions the average-daily-volume floor is measured over. */
export const ADV_WINDOW = 50;

/** Sessions the gap must have landed within to still be current. */
export const GAP_LOOKBACK = 20;

/** Sessions of quiet base required before the gap. */
export const BASE_LOOKBACK = 60;

/**
 * How much the 50-day average volume may have climbed across the base before it
 * counts as "already rising sharply" — which disqualifies the quiet-before
 * test. Measured as the average volume of the recent half of the base against
 * its earlier half. A judgment call on the spec's "not already rising sharply";
 * see `scan.ts`.
 */
export const BASE_VOLUME_RISE_MAX = 2;

/**
 * How clean an upward trend the base may have before it stops being "flat and
 * ignored" and becomes a stock that was already moving.
 *
 * The price-range test alone cannot tell a flat band from a rising channel of
 * the same amplitude — a stock that climbed smoothly 15% over the base has the
 * same high-minus-low as one that chopped sideways in a 15% range. So the base
 * closes are fit to a line, and a base that both rises materially
 * (`BASE_MIN_TREND_RISE`) *and* does so cleanly (R² at or above
 * `BASE_MAX_TREND_R2`) is rejected as already trending. A *falling* clean base
 * is kept — a gap up out of a downtrend is a reversal, which is exactly the
 * kind of ignored name this is meant to catch. Both are judgment calls, found
 * by hand-checking real findings (RSKD, a clean rising channel, was slipping
 * through the range filter); see the sanity-check notes.
 */
export const BASE_MAX_TREND_R2 = 0.5;
export const BASE_MIN_TREND_RISE = 0.1;

/**
 * Where in the gap day's range the close has to sit. The spec says "top half",
 * so the close must be at or above the midpoint of that day's high–low range.
 */
export const GAP_CLOSE_TOP_FRACTION = 0.5;

/**
 * Sessions the pause tracker measures tightening and volume-drying over. The
 * spec asks for "the last 5 sessions" against a 20-day volume average.
 */
export const PAUSE_TIGHT_WINDOW = 5;
export const PAUSE_VOLUME_WINDOW = 20;

/**
 * Sessions a name needs before it can be evaluated at all: a full base, a
 * gap that can sit up to `GAP_LOOKBACK` sessions ago, and a 50-session volume
 * average sitting before the base. The base and the volume average overlap, so
 * the floor is the base plus the lookback plus a small margin.
 */
export const MIN_BARS = BASE_LOOKBACK + GAP_LOOKBACK + 5;

// --- the finding -------------------------------------------------------------

/** What a name has done since its gap — the pause tracker, the important half. */
export interface EpisodicPause {
  /** Trading sessions elapsed since the gap day (0 on the gap day itself). */
  sessionsSinceGap: number;
  /**
   * Whether every close since the gap has held at or above the midpoint of the
   * gap day's range. False flags the name dead — the move failed to hold.
   */
  heldAboveMid: boolean;
  /** The gap-day range midpoint, the level `heldAboveMid` is measured against. */
  midpoint: number;
  /** The lowest close since the gap, so the reader can see how close to dead it is. */
  lowestCloseSinceGap: number;
  /**
   * Range of the last `PAUSE_TIGHT_WINDOW` sessions as a fraction,
   * (highest high − lowest low) / lowest low. Tightening — a smaller number —
   * is the constructive shape. Null when there are too few sessions since the gap.
   */
  last5RangePct: number | null;
  /**
   * Volume of the last `PAUSE_TIGHT_WINDOW` sessions against the trailing
   * `PAUSE_VOLUME_WINDOW`-session average. Below 1 means volume is drying up,
   * which is constructive. Null until there are `PAUSE_TIGHT_WINDOW` sessions
   * since the gap, so the last-five window is genuinely post-gap.
   */
  vol5vs20: number | null;
  /**
   * The high of the current tight range — the highest high over the last
   * `PAUSE_TIGHT_WINDOW` sessions — as a reference level. Null when too few
   * sessions since the gap.
   */
  tightRangeHigh: number | null;
}

/** One name the scan surfaced, with the raw numbers the UI re-thresholds on. */
export interface EpisodicFinding {
  symbol: string;
  /** Company name from the symbol directory, when it had one. */
  name: string | null;

  /** `YYYY-MM-DD` of the gap day. */
  gapDate: string;
  /** Gap size, open vs prior close, as a fraction. */
  gapPct: number;
  /** Gap-day volume / 50-day average volume. The default ranking key. */
  volumeRatio: number;
  /** Gap-day dollar volume: close × shares. */
  dollarVolume: number;
  /** The 60-session base range as a fraction, (high − low) / low. */
  baseRangePct: number;

  /** The gap day's own OHLC, kept so the row can show and mark it. */
  gapOpen: number;
  gapHigh: number;
  gapLow: number;
  gapClose: number;
  /** Gap-day share volume and the 50-day average behind `volumeRatio`. */
  gapVolume: number;
  avg50Volume: number;

  /** Most recent close in the fetched series — the "current price". */
  currentPrice: number;
  /** Current close vs the gap-day close, as a fraction (signed). */
  pctFromGapClose: number;

  pause: EpisodicPause;

  /**
   * The trailing daily bars for the row chart, oldest first — the base through
   * to the latest session, so the flat-then-jump shape and everything since is
   * visible. Self-contained on purpose: the row draws from these rather than
   * spending another upstream request per open.
   */
  bars: EpisodicBar[];
}

// --- the funnel --------------------------------------------------------------

/**
 * Where names dropped, measured at the capture envelope during the scan. This
 * is the "show what was scanned and how many dropped at each filter" record.
 * Ordered as the scan applies them; each count is the number *removed* at that
 * stage, so they sum with `survived` to `scanned`.
 */
export interface EpisodicFunnel {
  /** Symbols in the universe before this run's slice was taken. */
  universe: number;
  /** Symbols this run actually pulled bars for (its slice of the universe). */
  scanned: number;
  /** Dropped for too little price history to evaluate. */
  droppedShortHistory: number;
  /** Dropped below the price or average-volume floor. */
  droppedLiquidity: number;
  /** Reached the gap test but had no qualifying gap in the lookback window. */
  droppedNoGap: number;
  /** Had a gap but it was not fresh — another gap sat inside the prior base. */
  droppedNotFresh: number;
  /** Had a fresh gap but the base's price range was too wide to be "quiet". */
  droppedBaseTooWide: number;
  /** Had a tight base by range, but it was a clean rising trend — already moving. */
  droppedBaseTrending: number;
  /**
   * Had a fresh gap and a tight base, but the 50-day average volume was already
   * rising sharply into it. This is the count the `BASE_VOLUME_RISE_MAX`
   * judgment call removes — kept separate so its cost is always visible.
   */
  droppedBaseVolRising: number;
  /** Survivors — the findings this run produced. */
  survived: number;
  /** Symbols whose bar fetch failed outright (upstream error, not a verdict). */
  fetchFailed: number;
  /** Symbols not reached before the run's time budget ran out. */
  notReached: number;
}

// --- the view the page reads -------------------------------------------------

export interface EpisodicView {
  /** Every accumulated finding, unsorted — the board sorts and filters. */
  findings: EpisodicFinding[];
  /** The most recent run's funnel over its slice. */
  funnel: EpisodicFunnel | null;
  /** The shipped defaults, so the controls open where the spec says. */
  defaults: EpisodicParams;
  /** The capture floor and strict ceiling, so the sliders know their range. */
  capture: EpisodicParams;
  strict: EpisodicParams;

  /** New York date of the most recent run, or null when nothing is stored. */
  scanDate: string | null;
  /** ISO timestamp of the most recent run. */
  scannedAt: string | null;

  /** Whether the stored document survives a redeploy, and why not when it doesn't. */
  storeDurable: boolean;
  storeNote?: string;

  /** Plain-English coverage and freshness notes. */
  notes: string[];
  /** Judgment calls and data gaps, surfaced rather than buried. */
  caveats: string[];
}
