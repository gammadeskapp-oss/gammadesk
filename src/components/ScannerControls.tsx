'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  MAX_SAVED_PRESETS,
  readSavedPresets,
  readSavedPresetsOnServer,
  subscribeSavedPresets,
  writeSavedPresets,
} from '@/lib/scanner/filterState';
import {
  DEFAULT_FILTERS,
  FILTER_BOUNDS,
  type FilterSettings,
} from '@/lib/scanner/score';
import { RULE_KEYS, RULE_LABEL } from '@/lib/scanner/types';

/**
 * The controls bar.
 *
 * ## Every one of these was a constant three weeks ago
 *
 * The rule set was fixed in the run: RS 90, volume confirmed, equity liquidity
 * HIGH, above the 200-day, a 30-60 day contract at delta 0.55-0.70. Those are
 * defensible numbers and they are still the defaults — the sliders open on
 * exactly them — but they were nobody's numbers in particular, and a reader
 * who thought RS 90 was too strict had no way to find out.
 *
 * Now they are the reader's. What that costs is one obligation, discharged in
 * the copy under the bar and in the funnel above the table: a list assembled
 * at settings the reader chose has to keep saying that it was, so a screenshot
 * of it is not mistaken for the shipped rule set.
 *
 * ## Nothing here touches the network
 *
 * Every control filters the cached snapshot in the browser. That is not a
 * performance nicety — the scan spends the chain provider's daily request
 * budget, and a slider that could re-run it would put that budget at the mercy
 * of a drag gesture.
 */

const NUMBER_CLASS =
  'w-full border border-term-line bg-term-raised px-2 py-1 text-2xs tabular-nums text-term-text';

function Row({
  label,
  value,
  children,
  hint,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="label-xs">{label}</span>
        <span className="text-2xs font-bold tabular-nums text-term-text">{value}</span>
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-0.5 block text-2xs text-term-faint">{hint}</span>}
    </label>
  );
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-pos"
    />
  );
}

/**
 * A pair of sliders for a range.
 *
 * Two inputs rather than one two-thumb control, because a genuine dual-thumb
 * range needs either a dependency or a pile of pointer maths, and neither buys
 * anything here: the two numbers are independent, they are labelled, and the
 * clamping in `clampSettings` stops them crossing.
 */
function RangeRow({
  label,
  lo,
  hi,
  bounds,
  format,
  onChange,
}: {
  label: string;
  lo: number;
  hi: number;
  bounds: { min: number; max: number; step: number };
  format: (v: number) => string;
  onChange: (lo: number, hi: number) => void;
}) {
  return (
    <div>
      <span className="flex items-baseline justify-between gap-2">
        <span className="label-xs">{label}</span>
        <span className="text-2xs font-bold tabular-nums text-term-text">
          {format(lo)} – {format(hi)}
        </span>
      </span>
      <div className="mt-1 space-y-1">
        <Slider
          {...bounds}
          value={lo}
          ariaLabel={`${label} lower bound`}
          onChange={(v) => onChange(v, hi)}
        />
        <Slider
          {...bounds}
          value={hi}
          ariaLabel={`${label} upper bound`}
          onChange={(v) => onChange(lo, v)}
        />
      </div>
    </div>
  );
}

function money(v: number): string {
  return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}bn` : `$${Math.round(v / 1e6)}M`;
}

export function ScannerControls({
  settings,
  onChange,
  onReset,
  isDefault,
  shareUrl,
}: {
  settings: FilterSettings;
  onChange: (next: FilterSettings) => void;
  onReset: () => void;
  isDefault: boolean;
  /** The current configuration as a link, for the copy button. */
  shareUrl: string;
}) {
  /*
   * localStorage read as an external store rather than copied into state on
   * mount. It costs nothing extra and it means a configuration saved in
   * another tab shows up here — see `subscribeSavedPresets`.
   */
  const presets = useSyncExternalStore(
    subscribeSavedPresets,
    readSavedPresets,
    readSavedPresetsOnServer,
  );
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);

  const set = <K extends keyof FilterSettings>(key: K, value: FilterSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const savePreset = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    writeSavedPresets(
      [
        { name: trimmed, settings },
        ...presets.filter((p) => p.name !== trimmed),
      ].slice(0, MAX_SAVED_PRESETS),
    );
    setName('');
  };

  const deletePreset = (target: string) => {
    writeSavedPresets(presets.filter((p) => p.name !== target));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked. The URL is in the address bar either way — every
      // control writes to it — so there is nothing to recover from.
    }
  };

  const b = FILTER_BOUNDS;

  return (
    <section className="panel px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-dim">
          The filters, and where you have set them
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {!isDefault && (
            <span className="border border-flip/50 bg-flip/10 px-2 py-1 text-2xs font-bold tracking-[0.06em] text-flip">
              Changed from defaults
            </span>
          )}
          <button
            type="button"
            onClick={copyLink}
            className="border border-term-line px-2.5 py-1 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={isDefault}
            className="border border-term-line px-2.5 py-1 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos disabled:opacity-40"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Row
          label="Relative strength cutoff"
          value={String(settings.rsMin)}
          hint={`Shipped default ${DEFAULT_FILTERS.rsMin}. This is a percentile against the index, not a price.`}
        >
          <Slider
            {...b.rsMin}
            value={settings.rsMin}
            ariaLabel="Relative strength cutoff"
            onChange={(v) => set('rsMin', v)}
          />
        </Row>

        <Row
          label="Volume vs its own average"
          value={`${settings.volumeMult.toFixed(2)}x`}
          hint="1.00x is the confirmation line — the last month trading as heavily as the three months before it."
        >
          <Slider
            {...b.volumeMult}
            value={settings.volumeMult}
            ariaLabel="Volume multiple"
            onChange={(v) => set('volumeMult', v)}
          />
        </Row>

        <Row
          label="Minimum daily turnover"
          value={money(settings.minDollarVolume)}
          hint={`Shipped default ${money(DEFAULT_FILTERS.minDollarVolume)}. Names under $10M/day are not ranked at all and never reach this page.`}
        >
          <Slider
            {...b.minDollarVolume}
            value={settings.minDollarVolume}
            ariaLabel="Minimum average dollar volume"
            onChange={(v) => set('minDollarVolume', v)}
          />
        </Row>

        <Row
          label="Trend score cutoff"
          value={String(settings.trendMin)}
          hint="0-100, averaged over four readings: above the 50-day, above the 200-day, the 50 above the 200, and where its last month ranks against the index."
        >
          <Slider
            {...b.trendMin}
            value={settings.trendMin}
            ariaLabel="Trend score cutoff"
            onChange={(v) => set('trendMin', v)}
          />
        </Row>

        <RangeRow
          label="Days to expiry"
          lo={settings.dteMin}
          hi={settings.dteMax}
          bounds={b.dte}
          format={(v) => `${v}d`}
          onChange={(lo, hi) => onChange({ ...settings, dteMin: lo, dteMax: hi })}
        />

        <RangeRow
          label="Delta"
          lo={settings.deltaMin}
          hi={settings.deltaMax}
          bounds={b.delta}
          format={(v) => v.toFixed(2)}
          onChange={(lo, hi) => onChange({ ...settings, deltaMin: lo, deltaMax: hi })}
        />

        <Row
          label="Earnings buffer (days)"
          value={`${settings.earningsBufferDays}d`}
          hint="A name reporting inside this many days is removed. An unknown date never counts as clear."
        >
          <input
            type="number"
            min={b.earningsBufferDays.min}
            max={b.earningsBufferDays.max}
            value={settings.earningsBufferDays}
            aria-label="Earnings buffer in days"
            onChange={(e) => set('earningsBufferDays', Number(e.target.value))}
            className={NUMBER_CLASS}
          />
        </Row>
      </div>

      {/* --- the on/off switches ------------------------------------------- */}
      <div className="mt-3 border-t border-term-line pt-3">
        <span className="label-xs">Filters in force</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {RULE_KEYS.map((key) => {
            const on = settings.enabled[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set('enabled', { ...settings.enabled, [key]: !on })
                }
                className={`border px-2.5 py-1 text-2xs font-bold tracking-[0.08em] transition-colors ${
                  on
                    ? 'border-pos/70 bg-pos/15 text-pos'
                    : 'border-term-line text-term-faint hover:text-term-dim'
                }`}
              >
                {RULE_LABEL[key]} {on ? 'on' : 'off'}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-2xs leading-relaxed text-term-faint">
          These narrow the list; they do not empty it. A filter switched off
          stops counting toward the funnel and toward whether a name matches —
          but its reading is still shown on every row, greyed, because
          switching a filter off should not be able to make its number
          disappear. The table always shows the top twenty by score whatever is
          set here, so a filter nothing matches produces a sentence saying so
          rather than a blank page.
        </p>
      </div>

      {/* --- saved presets ---------------------------------------------------- */}
      <div className="mt-3 border-t border-term-line pt-3">
        <span className="label-xs">Saved configurations</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {presets.length === 0 && (
            <span className="text-2xs text-term-faint">
              None saved yet — up to {MAX_SAVED_PRESETS}, kept in this browser only.
            </span>
          )}
          {presets.map((preset) => (
            <span
              key={preset.name}
              className="inline-flex items-center border border-term-line"
            >
              <button
                type="button"
                onClick={() => onChange(preset.settings)}
                className="px-2.5 py-1 text-2xs font-bold tracking-[0.08em] text-term-dim transition-colors hover:text-pos"
              >
                {preset.name}
              </button>
              <button
                type="button"
                onClick={() => deletePreset(preset.name)}
                aria-label={`Delete the ${preset.name} configuration`}
                className="border-l border-term-line px-1.5 py-1 text-2xs text-term-faint transition-colors hover:text-bear"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={name}
            placeholder="Name this configuration"
            aria-label="Name for the saved configuration"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                savePreset();
              }
            }}
            className="w-56 border border-term-line bg-term-raised px-2 py-1 text-2xs text-term-text placeholder:text-term-faint"
          />
          <button
            type="button"
            onClick={savePreset}
            disabled={name.trim() === ''}
            className="border border-pos/50 bg-pos/10 px-2.5 py-1 text-2xs font-bold tracking-[0.08em] text-pos transition-colors hover:bg-pos/20 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
