import 'server-only';

import { readFileSync } from 'node:fs';

/**
 * Poster fonts, read once at module scope. `new URL(..., import.meta.url)` keeps
 * the path relative to this compiled module so Next's file tracing bundles the
 * woff files into the serverless function (a bare `process.cwd()` join is not
 * always traced). Latin-subset woff keeps each file ~30KB.
 *
 * Body is Inter; the mastheads ("The Morning Desk" / "The Closing Bell") and
 * big display figures use Lora, a serif chosen to match the Discord poster's
 * title face. Satori has no synthetic bold, so each weight is a real file.
 */
function load(file: string): ArrayBuffer {
  const buf = readFileSync(new URL(`./fonts/${file}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export interface PosterFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: 'normal';
}

export const POSTER_FONTS: PosterFont[] = [
  { name: 'Inter', data: load('Inter-Regular.woff'), weight: 400, style: 'normal' },
  { name: 'Inter', data: load('Inter-SemiBold.woff'), weight: 600, style: 'normal' },
  { name: 'Inter', data: load('Inter-Bold.woff'), weight: 700, style: 'normal' },
  { name: 'Lora', data: load('Lora-SemiBold.woff'), weight: 600, style: 'normal' },
  { name: 'Lora', data: load('Lora-Bold.woff'), weight: 700, style: 'normal' },
];
