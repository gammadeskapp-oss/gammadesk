import 'server-only';

import { readPosterData } from './store';
import { renderPoster } from './render';
import type { PosterKind } from './types';

export { savePosterData, readPosterData } from './store';
export { validatePoster } from './types';
export type { PosterData, PosterKind } from './types';

/**
 * Render the stored Cowork poster for a date+kind to PNG bytes for the X post,
 * or null when there is no stored payload (so the caller posts text-only). The
 * X-size variant (≤1200×1500) is used for posting. Never throws.
 */
export async function loadPosterImage(date: string, kind: PosterKind): Promise<Uint8Array | null> {
  const data = await readPosterData(date, kind).catch(() => null);
  if (!data) return null;
  try {
    const result = await renderPoster(data, 'x');
    return result.bytes;
  } catch {
    return null;
  }
}
