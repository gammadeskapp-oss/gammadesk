import 'server-only';

import { createJsonStore } from '../jsonStore';
import type { MacroBias } from './types';

export { storeStatus } from '../jsonStore';

/**
 * The last successfully computed Macro Bias record, kept in Vercel Blob beside
 * the other stored reads. One document, replaced each daily run.
 *
 * The box reads this and only this — never FRED on page load. Keeping the last
 * good record here is also what lets a failed refresh degrade to yesterday's
 * numbers rather than blanking the box: a dead FRED must not cost the reader the
 * backdrop it already had.
 */

const SCHEMA = 1;

export interface MacroBiasDoc {
  schema: number;
  bias: MacroBias;
  updatedAt: string;
}

const store = createJsonStore<MacroBiasDoc | null>(
  'gammadesk/macro-bias.json',
  () => null,
  (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw as MacroBiasDoc;
    if (doc.schema !== SCHEMA || !doc.bias || typeof doc.bias !== 'object') return null;
    return doc;
  },
);

export async function readMacroBiasDoc(): Promise<MacroBiasDoc | null> {
  return store.read();
}

export async function writeMacroBiasDoc(bias: MacroBias): Promise<MacroBiasDoc> {
  const doc: MacroBiasDoc = {
    schema: SCHEMA,
    bias,
    updatedAt: new Date().toISOString(),
  };
  await store.write(doc);
  return doc;
}
