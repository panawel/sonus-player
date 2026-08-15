// Pure artwork normalization — no Electron imports so it stays unit-testable.
//
// music-metadata returns embedded pictures as { format, data }. Three classes of
// corruption are repaired before the buffer is usable as a real image:
//   1. Bare extension format strings ("jpg" instead of "image/jpeg").
//   2. BMP embeds — skipped entirely (500KB+ uncompressed, Chromium renders them
//      poorly as blobs).
//   3. Apple Music/iTunes APIC frames where music-metadata strips leading header
//      bytes: JPEG loses 5 bytes (FF D8 FF E0 00), PNG loses up to 9 bytes
//      (8-byte signature + first byte of the IHDR chunk length).

const EXT_MAP = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const JFIF = Buffer.from([0x4A, 0x46, 0x49, 0x46]);
const IHDR = Buffer.from([0x49, 0x48, 0x44, 0x52]);
// PNG signature + IHDR chunk length (always 00 00 00 0D)
const PNG_PREFIX = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);

// pic: { format, data } from music-metadata (data may be Buffer or Uint8Array).
// Returns { mime, buffer } or null when the picture is unusable.
export function normalizePicture(pic) {
  if (!pic || !pic.data || pic.data.length === 0) return null;

  let fmt = (pic.format || '').toLowerCase();
  if (!fmt.includes('/')) {
    fmt = EXT_MAP[fmt] || 'image/jpeg';
  }
  if (fmt === 'image/jpg') fmt = 'image/jpeg';
  if (fmt === 'image/bmp') return null;

  let buf = Buffer.from(pic.data);

  if (fmt === 'image/jpeg' && (buf[0] !== 0xFF || buf[1] !== 0xD8)) {
    if (buf.slice(1, 5).equals(JFIF)) {
      buf = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00]), buf]);
    } else {
      return null;
    }
  } else if (fmt === 'image/png' && !(buf[0] === 0x89 && buf[1] === 0x50)) {
    let ihdrOffset = -1;
    for (let i = 0; i < 16; i++) {
      if (buf.slice(i, i + 4).equals(IHDR)) { ihdrOffset = i; break; }
    }
    if (ihdrOffset > 0 && ihdrOffset < 12) {
      buf = Buffer.concat([PNG_PREFIX.slice(0, 12 - ihdrOffset), buf]);
    } else {
      return null;
    }
  }

  return { mime: fmt, buffer: buf };
}

// Convenience wrapper: normalized picture as a base64 data URL (or null).
export function pictureToDataUrl(pic) {
  const norm = normalizePicture(pic);
  if (!norm) return null;
  return `data:${norm.mime};base64,${norm.buffer.toString('base64')}`;
}
