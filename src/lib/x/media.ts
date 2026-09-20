/**
 * Pure helpers for the poster-image feature: decoding/validating the base64
 * image field on the brief, and choosing which stored images the daily cleanup
 * may delete. No `server-only` and no IO, so both are unit-tested directly.
 */

/** X caps a tweet image at 5 MB; the brief field is validated to the same. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** PNG signature — the first eight bytes of every PNG file. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface DecodedImage {
  ok: boolean;
  /** Present when a valid image was supplied. Absent when the field was omitted. */
  bytes?: Uint8Array;
  mime?: string;
  error?: string;
}

/**
 * Decode and validate the optional `image` field on a brief.
 *
 * Absent/empty is fine (the image is optional): returns ok with no bytes. A
 * present value must be base64 (a `data:` URL prefix is tolerated and stripped),
 * decode to a PNG (checked by signature, not by trusting the caller), and be at
 * most 5 MB. Anything else is a validation failure the route turns into a 400.
 *
 * Note: Vercel caps a serverless request body near 4.5 MB, so a PNG larger than
 * ~3.3 MB will be rejected by the platform before it reaches here even though
 * this accepts up to 5 MB. Posters are far smaller than that in practice.
 */
export function decodeImageField(raw: unknown): DecodedImage {
  if (raw == null || raw === '') return { ok: true };
  if (typeof raw !== 'string') return { ok: false, error: 'image must be a base64 string.' };

  const comma = raw.indexOf(',');
  const b64 = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;

  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length === 0) return { ok: false, error: 'image decoded to empty.' };
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: `image exceeds 5 MB (${bytes.length} bytes decoded).` };
  }
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    return { ok: false, error: 'image is not a PNG (bad signature).' };
  }
  return { ok: true, bytes: new Uint8Array(bytes), mime: 'image/png' };
}

export interface StoredImageMeta {
  date: string;
  type: 'morning' | 'closing';
  receivedAt: string;
  size: number;
  posted: boolean;
  postedAt?: string;
  url?: string;
}

export const IMAGE_MAX_AGE_DAYS = 7;

/**
 * Which stored images the cleanup may delete: only those already **posted** and
 * older than the age limit. An image that has not been posted is never returned
 * here, whatever its age — the whole point of the rule is that a poster which
 * never made it out is not silently thrown away.
 */
export function selectImagesToDelete(
  entries: StoredImageMeta[],
  nowMs: number,
  maxAgeDays: number = IMAGE_MAX_AGE_DAYS,
): StoredImageMeta[] {
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  return entries.filter((e) => {
    if (!e.posted) return false;
    const at = Date.parse(e.receivedAt);
    return Number.isFinite(at) && at < cutoff;
  });
}
