'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import type { SymbolMatch } from '@/lib/symbols/search';

/**
 * The ticker box, everywhere one appears.
 *
 * Types ahead against symbol *and* company name, so someone who knows the
 * company but not the ticker can type "apple" and get AAPL — which is the
 * whole point for a beginner. Matching happens on the server; see
 * `app/api/symbols/route.ts` for why.
 *
 * Follows the ARIA combobox pattern: the input keeps focus throughout and the
 * highlighted row is announced through `aria-activedescendant`, rather than
 * focus hopping into the list.
 */

/** Long enough to skip a keystroke mid-word, short enough to feel immediate. */
const DEBOUNCE_MS = 130;

/** Distance kept from the viewport edge when the list has to be clamped. */
const MARGIN = 8;
/** Narrowest the list may be, so company names stay readable next to a
 *  compact input like the watchlist's. */
const MIN_WIDTH = 256;

const subscribeNever = () => () => {};

/** Client-only flag for `createPortal`, without a state-setting effect. */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export interface SymbolSearchProps {
  /** Runs when a row is chosen or the raw text is submitted. */
  onSubmit: (symbol: string) => void;
  inputId: string;
  /** Accessible label for the input. */
  label: string;
  placeholder: string;
  submitLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  initial?: string;
  /** Quick-pick chips under the box. Omit for none. */
  suggestions?: string[];
  /** `sm` is the inline variant used on the watchlist. */
  size?: 'lg' | 'sm';
  /** Blocks submit when the text is not a usable symbol. */
  validate?: (symbol: string) => boolean;
  /** Clear the box after a successful submit. */
  clearOnSubmit?: boolean;
  /** Blocks submit for a reason outside the text, e.g. a full watchlist. */
  disabled?: boolean;
}

export function SymbolSearch({
  onSubmit,
  inputId,
  label,
  placeholder,
  submitLabel,
  pendingLabel,
  pending = false,
  initial = '',
  suggestions,
  size = 'lg',
  validate,
  clearOnSubmit = false,
  disabled: blocked = false,
}: SymbolSearchProps) {
  const listId = `${useId()}-list`;

  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [results, setResults] = useState<{ q: string; items: SymbolMatch[] }>({
    q: '',
    items: [],
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const mounted = useMounted();

  const query = value.trim();
  const items = results.items;

  useEffect(() => {
    const q = value.trim();
    if (q.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/symbols?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((body: { results: SymbolMatch[] }) =>
          setResults({ q, items: body.results }),
        )
        .catch(() => {
          // Keep whatever is on screen. A dropdown that empties itself because
          // one request failed is worse than one showing slightly stale rows.
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const open = focused && !dismissed && query.length > 0 && items.length > 0;

  // Derived rather than stored, so a shrinking result list can never leave the
  // highlight pointing past the end.
  const active = open && highlight >= 0 && highlight < items.length ? highlight : -1;

  /*
   * The list is portalled to the body and positioned fixed.
   *
   * Absolute positioning inside the form looked fine on the search pages and
   * broke on the watchlist, where the surrounding `panel` sets `backdrop-blur`
   * — a backdrop filter creates a stacking context, so `z-30` could not lift
   * the list above the card that follows it, and half the rows rendered
   * underneath. Portalling sidesteps ancestor stacking and clipping entirely,
   * which matters for a component meant to be dropped anywhere.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const input = inputRef.current;
      const list = listRef.current;
      if (!input || !list) return;

      const anchor = input.getBoundingClientRect();
      const width = Math.min(
        Math.max(anchor.width, MIN_WIDTH),
        window.innerWidth - MARGIN * 2,
      );
      const left = Math.min(
        Math.max(MARGIN, anchor.left),
        Math.max(MARGIN, window.innerWidth - width - MARGIN),
      );

      // Flip above only when below genuinely does not fit — on a phone the
      // keyboard eats the lower half of the screen.
      const height = list.offsetHeight;
      const below = anchor.bottom + 4;
      const above = anchor.top - height - 4;
      const fitsBelow = below + height <= window.innerHeight - MARGIN;
      const top = fitsBelow || above < MARGIN ? below : above;

      list.style.width = `${width}px`;
      list.style.left = `${left}px`;
      list.style.top = `${Math.max(MARGIN, top)}px`;
      list.style.visibility = 'visible';
    };

    place();

    // Capture, because the scroll that moves the input is often an ancestor's.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, items.length]);

  const submit = (raw: string) => {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || blocked) return;
    if (validate && !validate(symbol)) return;

    setDismissed(true);
    setHighlight(-1);
    if (clearOnSubmit) setValue('');
    else setValue(symbol);
    onSubmit(symbol);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setDismissed(true);
      setHighlight(-1);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (items.length === 0) return;
      event.preventDefault();
      setDismissed(false);

      if (event.key === 'ArrowDown') {
        setHighlight(active < items.length - 1 ? active + 1 : 0);
      } else {
        setHighlight(active <= 0 ? items.length - 1 : active - 1);
      }
      return;
    }

    if (event.key === 'Enter' && active >= 0) {
      // Take the highlighted row instead of letting the form submit the
      // half-typed text underneath it.
      event.preventDefault();
      submit(items[active].symbol);
    }
  };

  const big = size === 'lg';

  const inputClass = big
    ? 'min-w-0 flex-1 border border-term-edge bg-term-panel px-3.5 py-2.5 text-sm tracking-[0.14em] text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none focus:ring-1 focus:ring-pos/40'
    : 'w-44 border border-term-edge bg-term-panel px-3 py-1.5 text-xs tracking-[0.12em] text-term-text placeholder:text-term-faint focus:border-pos/60 focus:outline-none';

  const buttonClass = big
    ? 'border border-pos/50 bg-pos/10 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-pos transition-colors hover:bg-pos/20 disabled:opacity-40'
    : 'border border-term-line bg-term-panel/60 px-3 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text disabled:opacity-40';

  const submitDisabled =
    pending ||
    blocked ||
    query.length === 0 ||
    (validate ? !validate(query.toUpperCase()) : false);

  return (
    <div className={big ? 'space-y-2.5' : ''}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>

        {/* Anchor for the dropdown. `flex-1` keeps the lg variant filling the
            row exactly as the plain input used to. */}
        <div className={`relative ${big ? 'min-w-0 flex-1' : ''}`}>
          <input
            ref={inputRef}
            id={inputId}
            name="symbol"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase());
              setDismissed(false);
              setHighlight(-1);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={10}
            className={`${inputClass} ${big ? 'w-full' : ''}`}
          />

          {open &&
            mounted &&
            createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Matching tickers"
              // Hidden until measured and placed, so it never flashes at the
              // top-left of the page.
              style={{ visibility: 'hidden' }}
              className="scroll-term fixed z-50 max-h-72 overflow-y-auto border border-pos/40 bg-term-raised shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
            >
              {items.map((item, i) => (
                <li
                  key={item.symbol}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown, not click: blur would close the list first and
                  // the click would land on nothing.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    submit(item.symbol);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex min-h-[2.75rem] cursor-pointer items-center gap-2 border-l-2 px-3 py-2 text-xs ${
                    i === active
                      ? 'border-l-pos bg-pos/12'
                      : 'border-l-transparent hover:bg-term-panel/60'
                  }`}
                >
                  <span
                    className={`w-14 shrink-0 font-bold tracking-[0.1em] ${
                      i === active ? 'text-pos' : 'text-term-text'
                    }`}
                  >
                    {item.symbol}
                  </span>
                  <span className="truncate text-term-dim">{item.name}</span>
                  {item.isEtf && (
                    <span className="ml-auto shrink-0 border border-term-line px-1.5 py-0.5 text-2xs tracking-[0.1em] text-term-faint">
                      ETF
                    </span>
                  )}
                </li>
              ))}
            </ul>,
            document.body,
          )}
        </div>

        <button type="submit" disabled={submitDisabled} className={buttonClass}>
          {pending && pendingLabel ? pendingLabel : submitLabel}
        </button>
      </form>

      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label-xs mr-1">Try</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              className="border border-term-line px-2 py-1 text-2xs tracking-[0.12em] text-term-faint transition-colors hover:border-term-edge hover:text-term-dim"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
