// In-browser OCR via Tesseract.js. Loaded on demand: the library, its WASM core
// and the English language data (~10 MB total, cached by the browser after the
// first scan) are fetched from the jsDelivr CDN only when an image is scanned.

// Tesseract reads best with capital letters ~30px+ tall; phone photos of small
// labels are often below that, and huge photos only slow it down.
const MIN_LONG_SIDE = 1600;
const MAX_LONG_SIDE = 3000;

// Grayscale + contrast stretch on a resized copy. Deliberately no hard
// black/white threshold: Tesseract binarizes internally (Otsu), and a global
// threshold applied here wipes out text on coloured or unevenly lit labels.
async function preprocess(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(MAX_LONG_SIDE / longSide, Math.max(1, MIN_LONG_SIDE / longSide));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const frame = ctx.getImageData(0, 0, width, height);
  const px = frame.data;
  const gray = new Uint8ClampedArray(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    gray[j] = g;
    histogram[g]++;
  }

  // Stretch the 1st–99th percentile range to full black→white.
  const clip = gray.length * 0.01;
  let low = 0;
  for (let sum = 0; low < 255 && (sum += histogram[low]) < clip; low++);
  let high = 255;
  for (let sum = 0; high > 0 && (sum += histogram[high]) < clip; high--);
  const range = Math.max(1, high - low);

  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = ((gray[j] - low) * 255) / range;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

export async function extractText(image: File, onProgress?: (progress: number) => void): Promise<string> {
  const [{ createWorker, PSM }, canvas] = await Promise.all([import('tesseract.js'), preprocess(image)]);
  const worker = await createWorker('eng', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    // Sparse-text mode finds scattered words, short labels, brand names and
    // lone letters/numbers that the default page-layout mode skips.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(canvas);
    return tidy(data.text);
  } finally {
    await worker.terminate();
  }
}

// Sparse mode returns one fragment per line with lots of blank lines between;
// collapse those so the description isn't mostly empty paragraphs.
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One paragraph per recognized line.
export function textToHtml(text: string): string {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}
