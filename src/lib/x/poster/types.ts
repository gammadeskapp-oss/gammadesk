/**
 * The full structured poster payload the Cowork task POSTs to `/api/brief`
 * alongside the minimal text-brief fields, so the app can render the same image
 * the Discord poster shows — every section, from the same numbers.
 *
 * Every section is optional. The renderer draws only the sections that are
 * present and non-empty, and closes the gap left by any it omits — there are
 * never "not available" placeholders on the X image (that is the Discord
 * poster's behaviour, not ours). If the core (`snapshot`) is missing, the
 * caller skips the image entirely and posts text-only.
 *
 * `validatePoster` below is strict: this is untrusted off-platform input, so
 * every field is type-checked and every string/array is bounded before storage.
 * It never throws and silently drops unknown or malformed optional sections
 * rather than rejecting the whole payload, so one bad section never costs the
 * whole poster.
 */

export type PosterKind = 'morning' | 'closing';

/** One market-snapshot card: an index/ETF with its level and day move. */
export interface PosterSnap {
  symbol: string;
  /** Last/close price, already formatted-ready as a number (e.g. 769.26). */
  price: number;
  /** Day move in percent points (e.g. -0.24 = -0.24%). Omit pre-open. */
  changePct?: number;
  /** A short line under the price (e.g. "cash close" or a sandbox note). */
  sub?: string;
}

/** The VIX expected-swing gauge (morning). */
export interface PosterVixSwing {
  vix: number;
  /** 30-day expected 1-day swing in percent (e.g. 0.9 = ±0.9%). */
  expectedSwingPct: number;
  /** One-line gloss under the gauge. */
  caption?: string;
}

/** A news / events line. */
export interface PosterNewsItem {
  text: string;
  /** Optional short tag shown at the row's right (e.g. "Fed", "Earnings"). */
  tag?: string;
}

/** A "most talked about" entry. */
export interface PosterTalkItem {
  name: string;
  /** Optional mention count or score shown at the right. */
  mentions?: number;
}

/** A sector row. */
export interface PosterSector {
  name: string;
  changePct: number;
}

/** A notable mover. */
export interface PosterMover {
  symbol: string;
  changePct: number;
}

/** A ranked Congress-trading entry. */
export interface PosterCongress {
  name: string;
  ticker?: string;
  trades: number;
}

/** An earnings name reporting. */
export interface PosterEarning {
  name: string;
  ticker?: string;
  /** e.g. "BMO" / "AMC" / "after close". */
  when?: string;
}

/** A cross-asset reaction row (closing). */
export interface PosterCrossAsset {
  name: string;
  /** Short colored tag, e.g. "+6bp" or "-1.2%". */
  tag?: string;
  note: string;
}

/** The numbered "Today's story" block (closing). */
export interface PosterStory {
  headline: string;
  points: string[];
}

/** "Tomorrow's watch" (closing). */
export interface PosterTomorrow {
  label?: string;
  items: string[];
}

export interface PosterData {
  kind: PosterKind;
  date: string;
  title: string;
  subtitle?: string;
  dateLabel?: string;
  asOfLabel?: string;

  snapshot: PosterSnap[];
  /**
   * The SPY-vs-RSP breadth verdict line, shown under the market snapshot, e.g.
   * "Big vs average stock: SPY ▲0.6% · RSP ▼0.2% → Narrow — big stocks carrying
   * it". Supply it from the shared GammaDesk reading (see `docs/x-poster-cowork.md`).
   */
  spyRsp?: string;

  // morning-leaning
  vixSwing?: PosterVixSwing;
  news?: PosterNewsItem[];
  mostTalked?: PosterTalkItem[];
  sectors?: PosterSector[];
  earnings?: PosterEarning[];

  // closing-leaning
  story?: PosterStory;
  crossAsset?: PosterCrossAsset[];
  strategists?: string;
  tomorrow?: PosterTomorrow;

  // shared
  movers?: { gainers: PosterMover[]; losers: PosterMover[] };
  congress?: PosterCongress[];

  footer?: { left?: string; right?: string };
}

export interface PosterValidation {
  ok: boolean;
  data?: PosterData;
  error?: string;
}

// --- bounds (keep the rendered poster, and the stored JSON, sane) ------------
const MAX = {
  str: 200,
  longStr: 400,
  snapshot: 8,
  news: 8,
  talk: 8,
  sectors: 12,
  movers: 10,
  congress: 8,
  earnings: 14,
  storyPoints: 8,
  crossAsset: 8,
  tomorrow: 8,
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown, max = MAX.str): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};
const arr = (v: unknown, cap: number): unknown[] => (Array.isArray(v) ? v.slice(0, cap) : []);

function snaps(v: unknown): PosterSnap[] {
  return arr(v, MAX.snapshot)
    .map((raw) => {
      if (!isObj(raw)) return null;
      const symbol = str(raw.symbol, 12);
      const price = num(raw.price);
      if (!symbol || price === undefined) return null;
      const snap: PosterSnap = { symbol, price };
      const c = num(raw.changePct);
      if (c !== undefined) snap.changePct = c;
      const sub = str(raw.sub, 60);
      if (sub) snap.sub = sub;
      return snap;
    })
    .filter((x): x is PosterSnap => x !== null);
}

function movers(v: unknown): PosterMover[] {
  return arr(v, MAX.movers)
    .map((raw) => {
      if (!isObj(raw)) return null;
      const symbol = str(raw.symbol, 12);
      const changePct = num(raw.changePct);
      if (!symbol || changePct === undefined) return null;
      return { symbol, changePct };
    })
    .filter((x): x is PosterMover => x !== null);
}

/**
 * Validate the optional `poster` object on a brief body. Returns a cleaned
 * `PosterData` or a reason. Missing `poster` is not an error for the caller to
 * decide — this is only called when a `poster` field is present.
 */
export function validatePoster(raw: unknown, kind: PosterKind, date: string): PosterValidation {
  if (!isObj(raw)) return { ok: false, error: 'poster must be a JSON object.' };

  const snapshot = snaps(raw.snapshot);
  if (snapshot.length === 0) {
    return { ok: false, error: 'poster.snapshot must have at least one valid {symbol, price}.' };
  }

  const data: PosterData = {
    kind,
    date,
    title: str(raw.title, 60) ?? (kind === 'morning' ? 'The Morning Desk' : 'The Closing Bell'),
    snapshot,
  };

  const subtitle = str(raw.subtitle, 80);
  if (subtitle) data.subtitle = subtitle;
  const dateLabel = str(raw.dateLabel, 40);
  if (dateLabel) data.dateLabel = dateLabel;
  const asOfLabel = str(raw.asOfLabel, 120);
  if (asOfLabel) data.asOfLabel = asOfLabel;
  const spyRsp = str(raw.spyRsp, 120);
  if (spyRsp) data.spyRsp = spyRsp;

  // VIX swing
  if (isObj(raw.vixSwing)) {
    const vix = num(raw.vixSwing.vix);
    const sw = num(raw.vixSwing.expectedSwingPct);
    if (vix !== undefined && sw !== undefined) {
      data.vixSwing = { vix, expectedSwingPct: sw };
      const cap = str(raw.vixSwing.caption, MAX.longStr);
      if (cap) data.vixSwing.caption = cap;
    }
  }

  // News
  const news = arr(raw.news, MAX.news)
    .map((r) => {
      if (!isObj(r)) return null;
      const text = str(r.text, MAX.longStr);
      if (!text) return null;
      const item: PosterNewsItem = { text };
      const tag = str(r.tag, 24);
      if (tag) item.tag = tag;
      return item;
    })
    .filter((x): x is PosterNewsItem => x !== null);
  if (news.length) data.news = news;

  // Most talked about
  const talk = arr(raw.mostTalked, MAX.talk)
    .map((r) => {
      if (!isObj(r)) return null;
      const name = str(r.name, 40);
      if (!name) return null;
      const item: PosterTalkItem = { name };
      const m = num(r.mentions);
      if (m !== undefined) item.mentions = m;
      return item;
    })
    .filter((x): x is PosterTalkItem => x !== null);
  if (talk.length) data.mostTalked = talk;

  // Sectors
  const sectors = arr(raw.sectors, MAX.sectors)
    .map((r) => {
      if (!isObj(r)) return null;
      const name = str(r.name, 40);
      const changePct = num(r.changePct);
      if (!name || changePct === undefined) return null;
      return { name, changePct };
    })
    .filter((x): x is PosterSector => x !== null);
  if (sectors.length) data.sectors = sectors;

  // Earnings
  const earnings = arr(raw.earnings, MAX.earnings)
    .map((r) => {
      // accept a plain string or an object
      if (typeof r === 'string') {
        const name = str(r, 40);
        return name ? { name } : null;
      }
      if (!isObj(r)) return null;
      const name = str(r.name, 40);
      if (!name) return null;
      const item: PosterEarning = { name };
      const ticker = str(r.ticker, 12);
      if (ticker) item.ticker = ticker;
      const when = str(r.when, 24);
      if (when) item.when = when;
      return item;
    })
    .filter((x): x is PosterEarning => x !== null);
  if (earnings.length) data.earnings = earnings;

  // Story
  if (isObj(raw.story)) {
    const headline = str(raw.story.headline, MAX.longStr);
    const points = arr(raw.story.points, MAX.storyPoints)
      .map((p) => str(p, MAX.longStr))
      .filter((x): x is string => !!x);
    if (headline || points.length) {
      data.story = { headline: headline ?? '', points };
    }
  }

  // Cross-asset
  const crossAsset = arr(raw.crossAsset, MAX.crossAsset)
    .map((r) => {
      if (!isObj(r)) return null;
      const name = str(r.name, 40);
      const note = str(r.note, MAX.longStr);
      if (!name || !note) return null;
      const item: PosterCrossAsset = { name, note };
      const tag = str(r.tag, 24);
      if (tag) item.tag = tag;
      return item;
    })
    .filter((x): x is PosterCrossAsset => x !== null);
  if (crossAsset.length) data.crossAsset = crossAsset;

  // Strategists
  const strategists = str(raw.strategists, MAX.longStr);
  if (strategists) data.strategists = strategists;

  // Tomorrow
  if (isObj(raw.tomorrow)) {
    const items = arr(raw.tomorrow.items, MAX.tomorrow)
      .map((p) => str(p, MAX.longStr))
      .filter((x): x is string => !!x);
    if (items.length) {
      data.tomorrow = { items };
      const label = str(raw.tomorrow.label, 40);
      if (label) data.tomorrow.label = label;
    }
  }

  // Movers
  if (isObj(raw.movers)) {
    const gainers = movers(raw.movers.gainers);
    const losers = movers(raw.movers.losers);
    if (gainers.length || losers.length) data.movers = { gainers, losers };
  }

  // Congress
  const congress = arr(raw.congress, MAX.congress)
    .map((r) => {
      if (!isObj(r)) return null;
      const name = str(r.name, 40);
      const trades = num(r.trades);
      if (!name || trades === undefined) return null;
      const item: PosterCongress = { name, trades };
      const ticker = str(r.ticker, 12);
      if (ticker) item.ticker = ticker;
      return item;
    })
    .filter((x): x is PosterCongress => x !== null);
  if (congress.length) data.congress = congress;

  // Footer
  if (isObj(raw.footer)) {
    const left = str(raw.footer.left, 120);
    const right = str(raw.footer.right, 120);
    if (left || right) data.footer = { ...(left ? { left } : {}), ...(right ? { right } : {}) };
  }

  return { ok: true, data };
}
