import 'server-only';

import { createJsonStore } from '../../jsonStore';
import type { PosterData, PosterKind } from './types';

/**
 * Durable storage for the structured poster payload the Cowork task POSTs with
 * each brief — one JSON document per market date and kind, so the renderer can
 * rebuild the exact image the Discord poster showed.
 *
 * Mirrors the rest of the app: Vercel Blob in production, a local JSON file
 * offline. Each date+kind is its own document (`createJsonStore` keys the local
 * fallback by basename, which stays unique).
 */
function store(date: string, kind: PosterKind) {
  return createJsonStore<PosterData | null>(
    `gammadesk/x-poster/${date}-${kind}.json`,
    () => null,
    (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PosterData) : null),
  );
}

export async function savePosterData(data: PosterData): Promise<void> {
  await store(data.date, data.kind).write(data);
}

export async function readPosterData(date: string, kind: PosterKind): Promise<PosterData | null> {
  return store(date, kind)
    .read()
    .catch(() => null);
}
