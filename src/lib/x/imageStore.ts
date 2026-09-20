import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createJsonStore, storeStatus } from '../jsonStore';
import { selectImagesToDelete, type StoredImageMeta } from './media';

/**
 * Storage for the Cowork poster images.
 *
 * The PNG bytes live in Vercel Blob (or local files offline, mirroring
 * `jsonStore.ts`), one object per date+type. A small JSON index tracks each
 * image's metadata — size, when it arrived, and crucially whether it has been
 * posted, which is what the cleanup consults so an unposted poster is never
 * deleted.
 */

type ImageType = 'morning' | 'closing';
type ImageIndex = Record<string, StoredImageMeta>;

const indexKey = (date: string, type: ImageType) => `${date}-${type}`;
const blobPath = (date: string, type: ImageType) => `gammadesk/x-images/${date}-${type}.png`;

const index = createJsonStore<ImageIndex>(
  'gammadesk/x-images.json',
  () => ({}),
  (raw) => (raw && typeof raw === 'object' ? (raw as ImageIndex) : null),
);

function fallbackDir(): string {
  return process.env.VERCEL
    ? path.join('/tmp', 'gammadesk', 'x-images')
    : path.join(process.cwd(), '.gammadesk', 'x-images');
}

function localImagePath(date: string, type: ImageType): string {
  return path.join(fallbackDir(), `${date}-${type}.png`);
}

/** Try private then public, remembering which the store accepts — as jsonStore does. */
let blobAccess: 'private' | 'public' | null = null;

async function putBlob(pathname: string, bytes: Uint8Array): Promise<string> {
  const { put } = await import('@vercel/blob');
  const base = { addRandomSuffix: false, allowOverwrite: true, contentType: 'image/png' } as const;
  const modes: Array<'private' | 'public'> = blobAccess ? [blobAccess] : ['private', 'public'];
  let lastError: unknown;
  for (const access of modes) {
    try {
      const res = await put(pathname, Buffer.from(bytes), { ...base, access });
      blobAccess = access;
      return res.url;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function getBlobBytes(pathname: string): Promise<Uint8Array | null> {
  const { get } = await import('@vercel/blob');
  const modes: Array<'private' | 'public'> = blobAccess ? [blobAccess] : ['private', 'public'];
  for (const access of modes) {
    try {
      const result = await get(pathname, { access });
      blobAccess = access;
      if (!result) return null;
      const buf = await new Response(result.stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      // wrong mode or missing — try the other, then give up
    }
  }
  return null;
}

async function delBlob(url: string): Promise<void> {
  const { del } = await import('@vercel/blob');
  await del(url);
}

/** Save (or overwrite) today's image for a type and record its metadata unposted. */
export async function saveImage(date: string, type: ImageType, bytes: Uint8Array): Promise<StoredImageMeta> {
  let url: string | undefined;
  if (storeStatus().kind === 'blob') {
    url = await putBlob(blobPath(date, type), bytes);
  } else {
    const p = localImagePath(date, type);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, Buffer.from(bytes));
    url = `file://${p}`;
  }

  const meta: StoredImageMeta = {
    date,
    type,
    receivedAt: new Date().toISOString(),
    size: bytes.length,
    posted: false,
    url,
  };
  await index.update((idx) => ({ ...idx, [indexKey(date, type)]: meta }));
  return meta;
}

/** The metadata for one image, or null. */
export async function readImageMeta(date: string, type: ImageType): Promise<StoredImageMeta | null> {
  const idx = await index.read().catch(() => ({}) as ImageIndex);
  return idx[indexKey(date, type)] ?? null;
}

/** The image bytes for a date+type, or null when there is none. */
export async function readImageBytes(date: string, type: ImageType): Promise<Uint8Array | null> {
  const meta = await readImageMeta(date, type);
  if (!meta) return null;
  if (storeStatus().kind === 'blob') return getBlobBytes(blobPath(date, type));
  try {
    return new Uint8Array(await fs.readFile(localImagePath(date, type)));
  } catch {
    return null;
  }
}

/** Mark an image as posted, so the cleanup may later retire it. Never throws. */
export async function markImagePosted(date: string, type: ImageType): Promise<void> {
  try {
    await index.update((idx) => {
      const cur = idx[indexKey(date, type)];
      if (!cur) return idx;
      return { ...idx, [indexKey(date, type)]: { ...cur, posted: true, postedAt: new Date().toISOString() } };
    });
  } catch {
    // best effort
  }
}

/** Today's morning and closing image metadata, for the admin console. */
export async function todaysImages(date: string): Promise<{ morning: StoredImageMeta | null; closing: StoredImageMeta | null }> {
  const idx = await index.read().catch(() => ({}) as ImageIndex);
  return {
    morning: idx[indexKey(date, 'morning')] ?? null,
    closing: idx[indexKey(date, 'closing')] ?? null,
  };
}

/**
 * Delete posted images older than the age limit. Never deletes an unposted
 * image (see `selectImagesToDelete`). Returns the keys removed. Never throws.
 */
export async function cleanupOldImages(now: Date = new Date()): Promise<{ deleted: string[]; kept: number }> {
  const idx = await index.read().catch(() => ({}));
  const entries = Object.values(idx);
  const toDelete = selectImagesToDelete(entries, now.getTime());

  for (const e of toDelete) {
    try {
      if (storeStatus().kind === 'blob') {
        if (e.url) await delBlob(e.url);
      } else {
        await fs.unlink(localImagePath(e.date, e.type)).catch(() => {});
      }
    } catch {
      // A failed delete just means it is retried next run; do not abort the batch.
    }
  }

  if (toDelete.length > 0) {
    await index
      .update((cur) => {
        const next = { ...cur };
        for (const e of toDelete) delete next[indexKey(e.date, e.type)];
        return next;
      })
      .catch(() => {});
  }

  return { deleted: toDelete.map((e) => indexKey(e.date, e.type)), kept: entries.length - toDelete.length };
}
