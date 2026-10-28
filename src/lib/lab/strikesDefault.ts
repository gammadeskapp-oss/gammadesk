import 'server-only';

import { createJsonStore } from '../jsonStore';

/**
 * The ticker list the Strikes tab's textarea opens with, saved by its "Update
 * default" button. The same JSON store every other small piece of state here
 * uses — Vercel Blob on a deploy, `.gammadesk/lab-strikes-default.json` locally.
 * Stored as the text the box held, so line breaks and order survive.
 */

export interface StrikesDefault {
  text: string;
  savedAtIso: string | null;
}

const FALLBACK: StrikesDefault = { text: 'SPY\nQQQ\nIWM', savedAtIso: null };

export const strikesDefaultStore = createJsonStore<StrikesDefault>(
  'gammadesk/lab-strikes-default.json',
  () => FALLBACK,
  (raw) => {
    const r = raw as Partial<StrikesDefault> | null;
    if (!r || typeof r.text !== 'string') return null;
    return { text: r.text, savedAtIso: typeof r.savedAtIso === 'string' ? r.savedAtIso : null };
  },
);
