// Shrinks a photo to a JPEG under 1 MB before it's stored with a transaction
// (the server rejects anything over 1 MiB). Steps quality down first, then
// dimensions, until it fits.
export const MAX_IMAGE_BYTES = 1_000_000;
const MAX_LONG_SIDE = 2000;
const QUALITIES = [0.85, 0.75, 0.65, 0.55];

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))), 'image/jpeg', quality),
  );
}

export async function resizeImage(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  try {
    let scale = Math.min(1, MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d')!;
      // JPEG has no alpha: paint transparent PNG areas white, not black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const blob = await toJpeg(canvas, quality);
        if (blob.size < MAX_IMAGE_BYTES) return blob;
      }
      scale *= 0.75;
    }
    throw new Error('image_too_large');
  } finally {
    bitmap.close();
  }
}
