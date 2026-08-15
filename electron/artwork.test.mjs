import { describe, it, expect } from 'vitest';
import { normalizePicture, pictureToDataUrl } from './artwork.mjs';

// A minimal valid-looking JPEG head: FF D8 FF E0 00 10 'JFIF' 00 ...
const FULL_JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x03]);
// A minimal valid-looking PNG head: signature + IHDR length + 'IHDR' ...
const FULL_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // signature
  0x00, 0x00, 0x00, 0x0D,                         // IHDR chunk length
  0x49, 0x48, 0x44, 0x52,                         // 'IHDR'
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
]);

describe('normalizePicture', () => {
  it('passes a valid JPEG through untouched', () => {
    const out = normalizePicture({ format: 'image/jpeg', data: FULL_JPEG });
    expect(out.mime).toBe('image/jpeg');
    expect(Buffer.compare(out.buffer, FULL_JPEG)).toBe(0);
  });

  it('normalizes bare extension format strings', () => {
    expect(normalizePicture({ format: 'jpg', data: FULL_JPEG }).mime).toBe('image/jpeg');
    expect(normalizePicture({ format: 'png', data: FULL_PNG }).mime).toBe('image/png');
  });

  it('corrects image/jpg to image/jpeg', () => {
    expect(normalizePicture({ format: 'image/jpg', data: FULL_JPEG }).mime).toBe('image/jpeg');
  });

  it('unknown bare format falls back to image/jpeg', () => {
    expect(normalizePicture({ format: 'weird', data: FULL_JPEG }).mime).toBe('image/jpeg');
  });

  it('skips BMP entirely', () => {
    expect(normalizePicture({ format: 'image/bmp', data: Buffer.from([0x42, 0x4D, 1, 2, 3]) })).toBeNull();
  });

  it('repairs Apple-stripped JPEG (5 missing leading bytes)', () => {
    const stripped = FULL_JPEG.slice(5); // starts 0x10 'JFIF'
    const out = normalizePicture({ format: 'image/jpeg', data: stripped });
    expect(out).not.toBeNull();
    expect(Buffer.compare(out.buffer, FULL_JPEG)).toBe(0);
  });

  it('repairs Apple-stripped PNG (9 missing leading bytes)', () => {
    const stripped = FULL_PNG.slice(9); // signature + 1 byte of IHDR length gone
    const out = normalizePicture({ format: 'image/png', data: stripped });
    expect(out).not.toBeNull();
    expect(Buffer.compare(out.buffer, FULL_PNG)).toBe(0);
  });

  it('repairs Apple-stripped PNG for every prefix length 1..11', () => {
    for (let n = 1; n <= 11; n++) {
      const out = normalizePicture({ format: 'image/png', data: FULL_PNG.slice(n) });
      expect(out, `strip ${n}`).not.toBeNull();
      expect(Buffer.compare(out.buffer, FULL_PNG), `strip ${n}`).toBe(0);
    }
  });

  it('rejects unrepairable JPEG garbage', () => {
    expect(normalizePicture({ format: 'image/jpeg', data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) })).toBeNull();
  });

  it('rejects unrepairable PNG garbage', () => {
    expect(normalizePicture({ format: 'image/png', data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) })).toBeNull();
  });

  it('returns null for missing/empty data', () => {
    expect(normalizePicture(null)).toBeNull();
    expect(normalizePicture({ format: 'image/jpeg', data: Buffer.alloc(0) })).toBeNull();
    expect(normalizePicture({ format: 'image/jpeg' })).toBeNull();
  });

  it('accepts Uint8Array data (music-metadata sometimes returns it)', () => {
    const out = normalizePicture({ format: 'image/jpeg', data: new Uint8Array(FULL_JPEG) });
    expect(out.mime).toBe('image/jpeg');
    expect(Buffer.compare(out.buffer, FULL_JPEG)).toBe(0);
  });
});

describe('pictureToDataUrl', () => {
  it('builds a data URL from a valid picture', () => {
    const url = pictureToDataUrl({ format: 'image/jpeg', data: FULL_JPEG });
    expect(url).toBe(`data:image/jpeg;base64,${FULL_JPEG.toString('base64')}`);
  });

  it('returns null for unusable pictures', () => {
    expect(pictureToDataUrl({ format: 'image/bmp', data: Buffer.from([1]) })).toBeNull();
  });
});
