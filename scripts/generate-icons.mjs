/*
 * Generates the PWA icon set from the gamma mark.
 *
 * The glyph is drawn as vector paths rather than rendered as text: SVG text
 * depends on whatever fonts the rasteriser can find, which differs between
 * this machine and CI, and a missing font would silently produce a blank
 * icon.
 *
 * Run: npm run icons
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.join(process.cwd(), 'public');

const BG = '#0a0e17'; // matches the site background and the manifest theme
const FG = '#f0a500'; // the brand amber used for the mark throughout

/**
 * The gamma mark on a 512 canvas.
 *
 * @param inset extra padding as a fraction, used for the maskable variant so
 *   the glyph survives being cropped to a circle by the launcher.
 */
function svg(inset = 0) {
  // Scale the glyph toward the centre by `inset`.
  const scale = 1 - inset;
  const translate = (512 * inset) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(${translate} ${translate}) scale(${scale})">
    <!-- The glyph spans y 150..430, so its centre sits ~34px below the
         canvas centre. Lift it to sit optically centred in the tile. -->
    <g transform="translate(0 -26)" fill="none" stroke="${FG}" stroke-width="42" stroke-linecap="round" stroke-linejoin="round">
      <!-- left arm of the gamma, down to the junction -->
      <path d="M150 150 L262 300"/>
      <!-- right arm, sweeping through the junction into the descender -->
      <path d="M362 150 C330 250, 268 330, 214 430"/>
    </g>
  </g>
</svg>`;
}

async function render(name, size, inset = 0) {
  const buffer = await sharp(Buffer.from(svg(inset)))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(OUT, name), buffer);
  console.log(`${name.padEnd(28)} ${size}x${size}  ${buffer.length} bytes`);
}

await mkdir(OUT, { recursive: true });

await render('icon-192.png', 192);
await render('icon-512.png', 512);
// Maskable icons get cropped to whatever shape the launcher wants, so the
// glyph is pulled well inside the safe zone.
await render('icon-maskable-512.png', 512, 0.28);
// iOS uses this for the home-screen tile and does not read the manifest.
await render('apple-touch-icon.png', 180);

console.log('\nIcons written to public/');
