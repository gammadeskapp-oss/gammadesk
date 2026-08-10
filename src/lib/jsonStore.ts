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

/**
 * Whichever access mode this store turned out to accept, remembered after the
 * first successful write so later writes do not retry the wrong one.
 */
let blobAccessMode: 'private' | 'public' | null = null;

/** Exposed for the health check, which reports what the store actually is. */
export function detectedBlobAccess(): 'private' | 'public' | null {
  return blobAccessMode;
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

  /**
   * Reads go through the authenticated `get`, not a fetch of the public URL.
   *
   * A private store's blob URL is not publicly fetchable at all, and `get`
   * works for both store types — so this one path is correct either way, and
   * sidesteps the CDN staleness that plagued reading a public URL right after
   * writing it.
   */
  async function readBlob(): Promise<T> {
    const { get } = await import('@vercel/blob');

    // `get` also needs to be told the store's access mode, and rejects the
    // wrong one — so it takes the same try-both-and-remember approach as write.
    const modes: Array<'private' | 'public'> = blobAccessMode
      ? [blobAccessMode]
      : ['private', 'public'];

    for (const access of modes) {
      try {
        const result = await get(blobPath, { access });
        blobAccessMode = access;
        if (!result) return fallback();
        return decode(await new Response(result.stream).text());
      } catch {
        // Wrong mode, or nothing stored yet. Try the other, then give up
        // quietly — an empty store is the normal state before the first write.
      }
    }
    return fallback();
  }

  async function writeBlob(value: T): Promise<void> {
    const { put } = await import('@vercel/blob');
    const body = JSON.stringify(value, null, 2);

    const base = {
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    } as const;

    /*
     * A store is configured as either public or private, and `put` rejects the
     * wrong one outright — "Cannot use public access on a private store". The
     * mode is not discoverable up front, so try private first (the safer
     * default for this data), fall back to public, and remember which worked.
     */
    const modes: Array<'private' | 'public'> = blobAccessMode
      ? [blobAccessMode]
      : ['private', 'public'];

    let lastError: unknown;
    for (const access of modes) {
      try {
        await put(blobPath, body, { ...base, access });
        blobAccessMode = access;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
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
