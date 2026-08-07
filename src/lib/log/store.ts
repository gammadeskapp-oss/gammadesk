import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LogEntry } from './types';

/**
 * Persistence for the accuracy log.
 *
 * Vercel's filesystem is ephemeral — anything written during a request is gone
 * on the next deploy, and often sooner. So in production the log lives in
 * Vercel Blob, which survives redeploys and is included in the free tier.
 * Locally, where there is no Blob token, it falls back to a JSON file so the
 * whole flow can be exercised offline.
 */

const BLOB_PATH = 'gammadesk/accuracy-log.json';
const LOCAL_PATH = path.join(process.cwd(), '.gammadesk', 'accuracy-log.json');

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
      ? 'BLOB_READ_WRITE_TOKEN is not set, so the log is written to an ephemeral filesystem and will be lost on the next deploy. Create a Blob store in the Vercel dashboard to make it durable.'
      : undefined,
  };
}

function sortNewestFirst(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

function parse(raw: string): LogEntry[] {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data as LogEntry[];
    if (Array.isArray(data?.entries)) return data.entries as LogEntry[];
    return [];
  } catch {
    return [];
  }
}

// --- Vercel Blob ------------------------------------------------------------

async function readBlob(): Promise<LogEntry[]> {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
  const blob = blobs.find((b) => b.pathname === BLOB_PATH) ?? blobs[0];
  if (!blob) return [];

  // Blob URLs sit behind a CDN; without no-store a fresh write can read back
  // as the previous version.
  const res = await fetch(blob.url, { cache: 'no-store' });
  if (!res.ok) return [];
  return parse(await res.text());
}

async function writeBlob(entries: LogEntry[]): Promise<void> {
  const { put } = await import('@vercel/blob');
  await put(BLOB_PATH, JSON.stringify({ entries }, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
}

// --- local file -------------------------------------------------------------

async function readFile(): Promise<LogEntry[]> {
  try {
    return parse(await fs.readFile(LOCAL_PATH, 'utf8'));
  } catch {
    return [];
  }
}

async function writeFile(entries: LogEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await fs.writeFile(LOCAL_PATH, JSON.stringify({ entries }, null, 2), 'utf8');
}

// --- public API -------------------------------------------------------------

export async function readLog(): Promise<LogEntry[]> {
  const entries =
    storeStatus().kind === 'blob' ? await readBlob() : await readFile();
  return sortNewestFirst(entries);
}

export async function writeLog(entries: LogEntry[]): Promise<void> {
  const sorted = sortNewestFirst(entries);
  if (storeStatus().kind === 'blob') await writeBlob(sorted);
  else await writeFile(sorted);
}

/**
 * Read, transform, write. There is no locking — the two cron jobs run hours
 * apart and each touches a different part of the log, so a lost update would
 * need two writers in the same second.
 */
export async function updateLog(
  mutate: (entries: LogEntry[]) => LogEntry[] | Promise<LogEntry[]>,
): Promise<LogEntry[]> {
  const current = await readLog();
  const next = await mutate(current);
  await writeLog(next);
  return next;
}
