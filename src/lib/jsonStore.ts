import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Durable JSON storage.
 *
 * Vercel's filesystem is ephemeral — anything written during a request is gone
 * on the next deploy, and often sooner. So in production these documents live
 * in Vercel Blob, which survives redeploys and is included in the free tier.
 * Locally, where there is no Blob token, they fall back to JSON files so the
 * whole flow can be exercised offline.
 */

export type StoreKind = 'blob' | 'file';

export interface StoreStatus {
  kind: StoreKind;
  /** True when writes are expected to survive a redeploy. */
  durable: boolean;
  note?: string;
}

export function storeStatus(): StoreStatus {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return { kind: 'blob', durable: true };
  }
  const onVercel = Boolean(process.env.VERCEL);
  return {
    kind: 'file',
    durable: !onVercel,
    note: onVercel
      ? 'BLOB_READ_WRITE_TOKEN is not set, so stored data is written to an ephemeral filesystem and will be lost on the next deploy. Create a Blob store in the Vercel dashboard to make it durable.'
      : undefined,
  };
}

export interface JsonStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
  update(mutate: (current: T) => T | Promise<T>): Promise<T>;
}

/**
 * @param blobPath  Path inside the Blob store, e.g. `gammadesk/foo.json`.
 * @param fallback  Value returned when nothing has been stored yet.
 * @param parse     Narrows the parsed JSON, and rejects anything unexpected.
 */
/**
 * Where the file fallback writes.
 *
 * On Vercel the deployment directory is read-only — only /tmp is writable — so
 * writing next to the source would throw rather than merely being ephemeral.
 * That turned "storage is not durable yet" into a 500, which reads like a
 * broken feature instead of a missing setting.
 */
function fallbackDir(): string {
  return process.env.VERCEL
    ? path.join('/tmp', 'gammadesk')
    : path.join(process.cwd(), '.gammadesk');
}

export function createJsonStore<T>(
  blobPath: string,
  fallback: () => T,
  parse: (raw: unknown) => T | null,
): JsonStore<T> {
  const localPath = path.join(fallbackDir(), blobPath.replace(/^.*\//, ''));

  const decode = (text: string): T => {
    try {
      return parse(JSON.parse(text)) ?? fallback();
    } catch {
      return fallback();
    }
  };

  async function readBlob(): Promise<T> {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const blob = blobs.find((b) => b.pathname === blobPath) ?? blobs[0];
    if (!blob) return fallback();

    // Blob URLs sit behind a CDN; without no-store a fresh write can read back
    // as the previous version.
    const res = await fetch(blob.url, { cache: 'no-store' });
    if (!res.ok) return fallback();
    return decode(await res.text());
  }

  async function writeBlob(value: T): Promise<void> {
    const { put } = await import('@vercel/blob');
    await put(blobPath, JSON.stringify(value, null, 2), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    });
  }

  async function readFile(): Promise<T> {
    try {
      return decode(await fs.readFile(localPath, 'utf8'));
    } catch {
      return fallback();
    }
  }

  async function writeFile(value: T): Promise<void> {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, JSON.stringify(value, null, 2), 'utf8');
  }

  return {
    async read() {
      return storeStatus().kind === 'blob' ? readBlob() : readFile();
    },
    async write(value) {
      if (storeStatus().kind === 'blob') await writeBlob(value);
      else await writeFile(value);
    },
    /**
     * Read, transform, write. There is no locking — the writers here run hours
     * apart on a cron, so a lost update would need two of them in the same
     * second.
     */
    async update(mutate) {
      const current = storeStatus().kind === 'blob' ? await readBlob() : await readFile();
      const next = await mutate(current);
      if (storeStatus().kind === 'blob') await writeBlob(next);
      else await writeFile(next);
      return next;
    },
  };
}
