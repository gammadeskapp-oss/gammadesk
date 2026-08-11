/*
 * Generates the whole GammaDesk brand set: profile icon, favicon, PWA icons,
 * the X/social banner and the header logo, plus the SVG sources they came
 * from.
 *
 * Run: npm run brand
 *
 * Everything is set in Consolas, including the mark, which is the real Greek
 * letter rather than a drawing of one. An earlier version drew the gamma as
 * two hand-authored strokes to avoid depending on a font at all; it read as a
 * lowercase 'y', because in a gamma the LEFT stroke carries the descender and
 * in a 'y' the right one does, and getting that wrong is the whole difference
 * between the two letters.
 *
 * The font dependency that comes with using real text is handled rather than
 * avoided. `assertFont` fails the build if the family is missing, because
 * librsvg does not report an unresolved family — it silently substitutes the
 * default sans, which for the letter that IS the logo would mean shipping the
 * wrong mark with no error at all. For the same reason `font-family` is given
 * as a single name: librsvg resolves a comma-separated list straight to the
 * generic fallback, which is how "Consolas, monospace" quietly renders as a
 * sans.
 *
 * The glyph's position is measured, not guessed — see `measureGlyph`. A gamma
 * has a descender, so its ink sits well below the baseline and nowhere near
 * the middle of its em box; centring it by eye would be wrong at every size.
 */

import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PUBLIC = path.join(process.cwd(), 'public');
const SRC = path.join(PUBLIC, 'brand');

// Palette, matching globals.css.
const BG = '#0a0e17';
const AMBER = '#f0a500';
const WHITE = '#ffffff';
const DIM = '#8494a8';

const FONT = 'Consolas';
const TAGLINE = 'Options data in plain English · gammadesk.app';

const round = (n, dp = 2) => Number(n.toFixed(dp));

// --- the gamma mark ---------------------------------------------------------

const GAMMA = '&#947;';
/** Size the glyph is measured at. Large enough that rounding is irrelevant. */
const REF = 400;

/**
 * Where the glyph's ink actually falls relative to its text origin, in units
 * of a REF-sized em.
 *
 * Found by rasterising the letter on its own and walking the alpha channel for
 * the first and last lit pixel on each axis. Rendered at the default 72dpi so
 * one pixel is one user unit.
 */
async function measureGlyph() {
  const pad = REF * 2;
  const originX = pad / 2;
  const originY = pad * 0.75;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pad}" height="${pad}"><text x="${originX}" y="${originY}" font-family="${FONT}" font-size="${REF}" font-weight="bold" fill="#000">${GAMMA}</text></svg>`;

  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) throw new Error('The gamma glyph rendered as nothing.');

  return {
    // Offset from the text origin to the top-left of the ink.
    dx: minX - originX,
    dy: minY - originY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/** Filled in once at startup, before any artwork is built. */
let INK = null;

/** The letter, scaled so its ink is `height` tall and centred on (cx, cy). */
function gammaMark({ cx, cy, height, color }) {
  const scale = height / INK.height;
  const size = REF * scale;
  const x = cx - (INK.dx + INK.width / 2) * scale;
  const y = cy - (INK.dy + INK.height / 2) * scale;

  return `<text x="${round(x)}" y="${round(y)}" font-family="${FONT}" font-size="${round(size)}" font-weight="bold" fill="${color}">${GAMMA}</text>`;
}

/** The mark's ink width once scaled to a given height. */
const markWidth = (height) => (height * INK.width) / INK.height;

// --- artwork ----------------------------------------------------------------

/**
 * Round profile icon: amber disc, dark glyph, transparent corners.
 *
 * `bleed` false insets the disc on a solid dark square instead, for the two
 * places a transparent corner is a liability — iOS composites transparency
 * onto black, and a maskable icon gets cropped to whatever shape the launcher
 * fancies.
 */
function roundIcon({ bleed = true } = {}) {
  const r = bleed ? 256 : 205; // 205 = 80% diameter, the maskable safe zone
  const glyph = bleed ? 280 : 225;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${bleed ? '' : `<rect width="512" height="512" fill="${BG}"/>`}
  <circle cx="256" cy="256" r="${r}" fill="${AMBER}"/>
  ${gammaMark({ cx: 256, cy: 256, height: glyph, color: BG })}
</svg>`;
}

/**
 * X / social banner.
 *
 * Everything sits in the upper two thirds. X overlays the profile picture on
 * the bottom-left of a header and the brief asked for the bottom-centre to
 * stay clear, so the whole bottom strip is left empty rather than just one
 * corner — that covers both, and every other platform's crop as well.
 */
function banner() {
  const discCx = 250;
  const discCy = 240;
  const discR = 112;

  const textX = 420;
  const wordSize = 100;
  const wordBaseline = 252;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500">
  <defs>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
      <path d="M44 0 L0 0 0 44" fill="none" stroke="${AMBER}" stroke-opacity="0.05" stroke-width="1"/>
    </pattern>
    <radialGradient id="wash" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <mask id="washMask"><rect width="1500" height="500" fill="url(#wash)"/></mask>
  </defs>

  <rect width="1500" height="500" fill="${BG}"/>
  <rect width="1500" height="500" fill="url(#grid)" mask="url(#washMask)"/>

  <circle cx="${discCx}" cy="${discCy}" r="${discR}" fill="${AMBER}"/>
  ${gammaMark({ cx: discCx, cy: discCy, height: 122, color: BG })}

  <text x="${textX}" y="${wordBaseline}" font-family="${FONT}" font-size="${wordSize}" font-weight="bold" fill="${WHITE}">Gamma<tspan fill="${AMBER}">Desk</tspan></text>
  <text x="${textX + 4}" y="306" font-family="${FONT}" font-size="31" fill="${DIM}">${TAGLINE}</text>
</svg>`;
}

/** Header logo: mark plus wordmark, transparent background. */
function headerLogo() {
  const glyph = 112;
  const markCx = 20 + markWidth(glyph) / 2;
  const textX = 20 + markWidth(glyph) + 26;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="580" height="180" viewBox="0 0 580 180">
  ${gammaMark({ cx: markCx, cy: 90, height: glyph, color: AMBER })}
  <text x="${round(textX)}" y="118" font-family="${FONT}" font-size="76" font-weight="bold" fill="${WHITE}">Gamma<tspan fill="${AMBER}">Desk</tspan></text>
</svg>`;
}

// --- favicon ----------------------------------------------------------------

/**
 * Packs PNGs into an .ico. Every browser still in use reads PNG-compressed
 * entries, so there is no need to emit a bitmap for each size.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;

  images.forEach(({ size, data }, i) => {
    const at = 16 * i;
    // 256 is stored as 0 in a single byte.
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette entries
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

// --- guards -----------------------------------------------------------------

/**
 * Fails loudly if the wordmark font is missing.
 *
 * librsvg does not report an unresolved family, it just draws with the default
 * one, so the only way to catch it is to compare against text rendered in a
 * family that certainly does not exist.
 */
async function assertFont() {
  const render = async (family) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="120"><text x="10" y="85" font-family="${family}" font-size="64" font-weight="bold" fill="#fff">GammaDesk</text></svg>`;
    const raw = await sharp(Buffer.from(svg)).raw().toBuffer();
    return crypto.createHash('md5').update(raw).digest('hex');
  };

  const [wanted, fallback] = await Promise.all([
    render(FONT),
    render('NoSuchFamily-GammaDesk'),
  ]);

  if (wanted === fallback) {
    throw new Error(
      `Font "${FONT}" is not installed — the wordmark would silently render in ` +
        `the default sans. Install it, or change FONT in this script and ` +
        `regenerate every asset so they stay consistent.`,
    );
  }
}

// --- output -----------------------------------------------------------------

/*
 * Rasterised above the target size and scaled down. librsvg renders at
 * 72dpi by default, which for an icon that is mostly one thick curve leaves
 * visibly stepped edges; supersampling costs nothing here and fixes it.
 */
async function png(svg, file, size, height, density = 216) {
  const image = sharp(Buffer.from(svg), { density });
  const resized = size ? image.resize(size, height ?? size) : image;
  const data = await resized.png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(PUBLIC, file), data);
  console.log(`  ${file.padEnd(26)} ${data.length.toLocaleString('en-US')} bytes`);
  return data;
}

async function svgSource(svg, file) {
  // The note matters: these are editable sources, and text that has not been
  // converted to outlines renders in whatever the viewer can find instead.
  const note = `<!-- GammaDesk brand source. Text is set in ${FONT}; convert to
     outlines before handing this to anything that may not have it.
     Regenerate with: npm run brand -->\n`;
  await writeFile(path.join(SRC, file), note + svg + '\n', 'utf8');
  console.log(`  brand/${file}`);
}

await assertFont();
INK = await measureGlyph();
console.log(
  `Glyph measured: ${INK.width}x${INK.height} ink at ${REF}px, ` +
    `origin offset (${INK.dx}, ${INK.dy})`,
);

await mkdir(SRC, { recursive: true });

const round512 = roundIcon();
const roundInset = roundIcon({ bleed: false });
const bannerSvg = banner();
const logoSvg = headerLogo();

console.log('\nProfile / PWA icons');
await png(round512, 'icon-512.png', 512);
await png(round512, 'icon-192.png', 192);
// Cropped by the launcher, and composited onto black by iOS: both want the
// solid background and the inset disc.
await png(roundInset, 'icon-maskable-512.png', 512);
await png(roundInset, 'apple-touch-icon.png', 180);

console.log('\nSocial');
// Lower density: the banner is already large, and 3x would rasterise a
// 4500x1500 intermediate for no visible gain.
await png(bannerSvg, 'banner-x.png', 1500, 500, 144);

console.log('\nHeader logo (transparent)');
await png(logoSvg, 'logo-header.png', 580, 180);
await png(logoSvg, 'logo-header@2x.png', 1160, 360);

console.log('\nFavicon');
const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(
  icoSizes.map(async (size) => ({
    size,
    data: await sharp(Buffer.from(round512), { density: 216 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  })),
);
const ico = buildIco(icoImages);
await writeFile(path.join(PUBLIC, 'favicon.ico'), ico);
console.log(
  `  favicon.ico                ${ico.length.toLocaleString('en-US')} bytes (${icoSizes.join(', ')})`,
);

console.log('\nSVG sources');
await svgSource(round512, 'icon-round.svg');
await svgSource(roundInset, 'icon-round-inset.svg');
await svgSource(bannerSvg, 'banner-x.svg');
await svgSource(logoSvg, 'logo-header.svg');

console.log('\nDone.');
