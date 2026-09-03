/*
 * What is actually in the Blob store, and how big.
 *
 * Read-only. Exists because "the page shows nothing" and "the store is empty"
 * and "the store has a document this build rejects" look identical from the
 * outside and need completely different fixes.
 *
 * Run: node scripts/probe-blob.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

const { list } = await import('@vercel/blob');

for (const access of ['private', 'public']) {
  try {
    const result = await list({ access, prefix: 'gammadesk/' });
    console.log(`\naccess=${access}: ${result.blobs.length} blobs`);
    for (const blob of result.blobs.sort((a, b) => a.pathname.localeCompare(b.pathname))) {
      console.log(
        `  ${blob.pathname.padEnd(38)} ${String(blob.size).padStart(10)} bytes  ${blob.uploadedAt}`,
      );
    }
    break;
  } catch (error) {
    console.log(`access=${access} failed: ${error instanceof Error ? error.message : error}`);
  }
}
