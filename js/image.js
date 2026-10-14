// Browser-only helpers. Decode a photo and make the model, diary and thumbnail copies.
const NATIVE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Files over this are re-encoded even when small in pixels. Gemini caps a request at 20 MB.
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

// Returns { mime, base64, bytes, keep, thumb }. base64 is exactly what the model sees.
// The model gets a copy capped at modelPx, re-encoded as JPEG. A photo already that small
// in a format the APIs take is sent as is. keep is the diary copy, capped at keepPx.
export async function prepareImage(file, thumbPx, keepPx, modelPx, quality) {
  const src = await decode(file);
  try {
    const longSide = Math.max(src.width, src.height);
    const native = NATIVE_MIMES.has(file.type) && file.size <= MAX_NATIVE_BYTES;
    const thumb = canvasFor(src, thumbPx).toDataURL('image/jpeg', 0.7);
    const forModel = native && longSide <= modelPx ? file : await toBlob(canvasFor(src, modelPx), quality);
    let keep = file;
    if (longSide > keepPx) keep = await toBlob(canvasFor(src, keepPx), 0.9);
    else if (!native) keep = await toBlob(canvasFor(src, Infinity), 0.92);
    return { mime: forModel.type, base64: await toBase64(forModel), bytes: forModel.size, keep, thumb };
  } finally {
    if (src.close) src.close();
  }
}
