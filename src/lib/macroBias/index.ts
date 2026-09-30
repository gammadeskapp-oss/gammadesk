import 'server-only';

import { config } from '../config';
import { getBreadth } from '../breadth';
import { eventRow, highImportanceToday } from '../events';
import { marketToday } from '../time';
import { fetchFredSeries, FRED_SERIES } from './fred';
import { computeMacroBias } from './compute';
import { computeRichMacroBias, changedLine } from './rich/compute';
import { readRichMacroDoc, writeRichMacroDoc } from './rich/store';
import { readMacroBiasDoc, writeMacroBiasDoc, type MacroBiasDoc } from './store';
import type { MacroBias } from './types';
import type { RichMacroBias, RichMacroHistoryEntry } from './rich/types';

export type { MacroBias, MacroFactor, FactorDirection } from './types';
export type { RichMacroBias, RichMacroDriver, RichMacroHistoryEntry } from './rich/types';
export { storeStatus } from './store';

export interface RefreshResult {
  stored: boolean;
  bias: MacroBias | null;
  /** Set when FRED failed and the stored record was left untouched. */
  error?: string;
  /** The −5…+5 model's outcome, refreshed alongside on its own footing. */
  rich?: { stored: boolean; score: number | null; error?: string };
}

/** Bundle the card reads: today's −5…+5 reading plus the prior days. */
export interface RichMacroView {
  current: RichMacroBias;
  history: RichMacroHistoryEntry[];
}

/**
 * Short daily-series window for the wide model. The four inputs are all
 * business-day series scored on their own last two prints, so a month is ample
 * and far cheaper than the legacy 800-day CPI window.
 */
const RICH_LOOKBACK_DAYS = 40;
const DAY_MS = 86_400_000;
function richStart(): string {
  return new Date(Date.now() - RICH_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Rebuild and store the −5…+5 model. Separate from the legacy store so a
 * failure in one never blanks the other. Appends yesterday's reading to the
 * history when the date rolls over; a same-day re-run replaces `current` and
 * leaves the history untouched.
 */
async function refreshRichMacroBias(): Promise<RefreshResult['rich']> {
  try {
    const start = richStart();
    const [tenYear, dollar, vix, credit, breadth] = await Promise.all([
      fetchFredSeries(FRED_SERIES.tenYear, start),
      fetchFredSeries(FRED_SERIES.dollar, start),
      fetchFredSeries(FRED_SERIES.vix, start),
      fetchFredSeries(FRED_SERIES.hyOas, start),
      getBreadth().catch(() => null),
    ]);

    const rows = eventRow();
    const nextEventLabel = rows[0]?.name ?? 'None scheduled';
    const imminent = rows.find((e) => e.importance === 'high' && e.when === 'today');
    const imminentEventLabel = highImportanceToday() ? (imminent?.name ?? 'High-impact event') : null;

    const dateKey = marketToday();
    const now = new Date().toISOString();

    const current = computeRichMacroBias(
      {
        tenYear,
        dollar,
        vix,
        credit,
        breadthPct: breadth?.computed?.pctAbovePriorClose ?? null,
        imminentEventLabel,
        nextEventLabel,
      },
      {
        tenYearFlatPp: config.macroBias.tenYearFlatPp,
        dollarFlatPct: 0.1,
        creditFlatPp: 0.05,
        vixCalm: 16,
        vixStress: 20,
      },
      dateKey,
      now,
    );

    const prevDoc = await readRichMacroDoc();
    const prev = prevDoc?.current ?? null;
    // What flipped today versus the last stored reading.
    current.changed = changedLine(current, prev);

    let history = prevDoc?.history ?? [];
    // Roll the previous day into history only when the date actually changed;
    // its `changed` was computed when it was the current reading.
    if (prev && prev.dateKey !== dateKey) {
      const entry: RichMacroHistoryEntry = {
        date: prev.dateKey,
        score: prev.score,
        label: prev.label,
        changed: prev.changed || 'First reading tracked',
        nextEvent: prev.nextEventLabel,
      };
      history = [entry, ...history];
    }

    await writeRichMacroDoc(current, history);
    return { stored: true, score: current.score };
  } catch (error) {
    return {
      stored: false,
      score: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The stored −5…+5 record for the Home macro card. A pure read — no FRED, no
 * compute — so it costs one storage read. Null before the first cron run.
 */
export async function getRichMacroBias(): Promise<RichMacroView | null> {
  const doc = await readRichMacroDoc();
  return doc ? { current: doc.current, history: doc.history } : null;
}

/**
 * Rebuild the Macro Bias record from FRED and store it. Called once a day by
 * the cron route.
 *
 * On any FRED failure the existing record is left in place and the error is
 * returned, not thrown — the daily job logging a miss is fine, blanking the box
 * because one refresh failed is not.
 */
export async function refreshMacroBias(): Promise<RefreshResult> {
  // The legacy 3-factor record and the −5…+5 model are refreshed on their own
  // footing so a failure in one never blanks the other.
  const legacy = await refreshLegacyMacroBias();
  const rich = await refreshRichMacroBias();
  return { ...legacy, rich };
}

async function refreshLegacyMacroBias(): Promise<Omit<RefreshResult, 'rich'>> {
  try {
    const [fed, tenYear, cpi] = await Promise.all([
      fetchFredSeries(FRED_SERIES.fedUpper),
      fetchFredSeries(FRED_SERIES.tenYear),
      fetchFredSeries(FRED_SERIES.cpi),
    ]);

    const bias = computeMacroBias(
      fed,
      tenYear,
      cpi,
      {
        fedLookbackDays: config.macroBias.fedLookbackDays,
        tenYearFlatPp: config.macroBias.tenYearFlatPp,
        cpiFlatPp: config.macroBias.cpiFlatPp,
      },
      new Date().toISOString(),
    );

    await writeMacroBiasDoc(bias);
    return { stored: true, bias };
  } catch (error) {
    return {
      stored: false,
      bias: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The stored record for the box to render. A pure read — no FRED call, no
 * compute — so it costs one storage read and never an upstream request. Null
 * when nothing has been stored yet (a fresh deploy before the first cron run),
 * which the box renders as "Updating…".
 */
export async function getMacroBias(): Promise<MacroBias | null> {
  const doc: MacroBiasDoc | null = await readMacroBiasDoc();
  return doc?.bias ?? null;
}
