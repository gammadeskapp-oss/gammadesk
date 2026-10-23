/*
 * Print a LAB_PASSWORD_HASH for /lab.
 *
 *   node scripts/lab-hash.mjs '<password>'
 *
 * Paste the printed line into the LAB_PASSWORD_HASH environment variable. The
 * password itself is never stored anywhere; only this salted scrypt hash is.
 * Same format as `hashLabPassword` in src/lib/lab/auth.ts.
 */
import { randomBytes, scryptSync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("usage: node scripts/lab-hash.mjs '<password>'");
  process.exit(1);
}
const N = 16384;
const r = 8;
const p = 1;
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
console.log(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
