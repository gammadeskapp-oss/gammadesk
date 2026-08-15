'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIPS, type TooltipKey } from '@/lib/tooltips';

/**
 * The small `?` beside a number, and the bubble it opens.
 *
 * The bubble is portalled to the body and positioned `fixed`. Several of these
 * sit inside tables that scroll and clip their own overflow, which would
 * swallow an absolutely positioned bubble or force it to scroll away from the
 * number it describes.
 *
 * Wording lives in `lib/tooltips.ts` — this file only decides where the bubble
 * goes.
 */

/** Distance kept from the viewport edge. */
const MARGIN = 8;
/** Distance between the button and the bubble. */
const GAP = 6;

const subscribeNever = () => () => {};

/**
 * Client-only flag, without a state-setting effect: `createPortal` needs a
 * `document`, and the lint rules here rightly reject `useEffect(() => setX())`.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function InfoTip({
  for: key,
  className = '',
  children,
}: {
  for: TooltipKey;
  className?: string;
  /**
   * Custom trigger content, in place of the `?` circle.
   *
   * Lets an existing piece of text open the bubble itself — the CONF/UNCONF
   * badge on /strength does this. It matters that the trigger stays a
   * `button`: the whole point over a `title` attribute is that a tap opens it,
   * and only a real control gets that on a touch screen.
   */
  children?: ReactNode;
}) {
  const tip = TOOLTIPS[key];
  const id = useId();
  const mounted = useMounted();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  /*
   * Hover and tap are tracked apart. A pointer leaving should close a bubble
   * that hovering opened, but must not close one the user deliberately tapped
   * — on a phone the finger is gone the moment the bubble appears.
   */
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const bubble = bubbleRef.current;
    if (!button || !bubble) return;

    // Measured then written straight to the node. Holding the coordinates in
    // state would cost a render and show one frame in the wrong place.
    const anchor = button.getBoundingClientRect();
    const box = bubble.getBoundingClientRect();

    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - box.width / 2),
      Math.max(MARGIN, window.innerWidth - box.width - MARGIN),
    );

    // Below by default; above only when below would run off-screen and above
    // actually fits.
    const below = anchor.bottom + GAP;
    const above = anchor.top - box.height - GAP;
    const fitsBelow = below + box.height <= window.innerHeight - MARGIN;
    const top = fitsBelow || above < MARGIN ? below : above;

    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(MARGIN, top)}px`;
    bubble.style.visibility = 'visible';
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const close = () => {
      setHovered(false);
      setPinned(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    const onPointerDown = (event: Event) => {
      if (!buttonRef.current?.contains(event.target as Node)) close();
    };

    window.addEventListener('keydown', onKeyDown);
    // Capture phase: the scroll that matters is often a table's, not the
    // window's, and those do not bubble.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const toggle = () => {
    const next = !pinned;
    setPinned(next);
    // Tapping also focuses, so unpinning has to clear the hover flag too or
    // the second tap would appear to do nothing.
    if (!next) setHovered(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`What is ${tip.label}?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={toggle}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setHovered(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setHovered(false);
        }}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className={
          children
            ? `inline-flex shrink-0 select-none items-center gap-1 underline decoration-dotted underline-offset-2 transition-colors ${
                open ? 'text-pos' : ''
              } ${className}`
            : `inline-flex h-4 w-4 shrink-0 select-none items-center justify-center rounded-full border text-[0.5625rem] font-bold leading-none transition-colors ${
                open
                  ? 'border-pos/70 bg-pos/15 text-pos'
                  : 'border-term-edge text-term-faint hover:border-pos/60 hover:text-pos'
              } ${className}`
        }
      >
        {children ?? <span aria-hidden>?</span>}
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            // Hidden until measured, and never a pointer target: a bubble that
            // can be hovered flickers when it opens under the cursor.
            style={{ visibility: 'hidden' }}
            className="pointer-events-none fixed z-[60] w-[min(19rem,calc(100vw_-_1rem))] border border-pos/40 bg-term-raised px-3 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
          >
            <div className="text-2xs font-bold uppercase tracking-[0.14em] text-pos">
              {tip.label}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-term-text">{tip.plain}</p>
            {tip.detail && (
              <p className="mt-2 border-t border-term-line pt-2 text-2xs leading-relaxed text-term-faint">
                {tip.detail}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
