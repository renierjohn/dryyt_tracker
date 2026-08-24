import { describe, it, expect } from 'vitest';
import { detectImageMimeType } from '../worker/image';

describe('detectImageMimeType', () => {
  it('detects a JPEG by its magic bytes', () => {
    expect(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
  });

  it('detects a PNG by its magic bytes', () => {
    expect(detectImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('detects a WEBP by its magic bytes', () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    bytes.set([0, 0, 0, 0], 4); // file size, irrelevant to detection
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
    expect(detectImageMimeType(bytes)).toBe('image/webp');
  });

  it('returns null for non-image bytes, even if they look plausible', () => {
    expect(detectImageMimeType(new TextEncoder().encode('<html>not an image</html>'))).toBeNull();
  });

  it('returns null for empty or too-short input', () => {
    expect(detectImageMimeType(new Uint8Array([]))).toBeNull();
    expect(detectImageMimeType(new Uint8Array([0xff]))).toBeNull();
  });
});
