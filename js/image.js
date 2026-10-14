// Browser-only helpers. The model gets the original photo bytes, never a resized copy.
const NATIVE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Gemini caps a request at 20 MB. Base64 adds a third, so stay under this.
const MAX_NATIVE_BYTES = 12 * 1024 * 1024;

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasFor(src, maxPx) {
  const s = Math.min(1, maxPx / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const toBlob = (canvas, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', quality));

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Returns { mime, base64, blob, thumb }. blob is exactly what the model sees.
// Only formats the APIs reject (HEIC) or files over the size cap are re-encoded, at full resolution.
export async function prepareImage(file, thumbPx) {
  const src = await decode(file);
  try {
    const thumb = canvasFor(src, thumbPx).toDataURL('image/jpeg', 0.7);
    let blob = file;
    if (!NATIVE_MIMES.has(file.type) || file.size > MAX_NATIVE_BYTES) {
      blob = await toBlob(canvasFor(src, Infinity), 0.92);
    }
    return { mime: blob.type, base64: await toBase64(blob), blob, thumb };
  } finally {
    if (src.close) src.close();
  }
}
