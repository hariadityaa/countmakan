// Browser-only helpers. Decode, resize and re-encode a photo as JPEG.
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

function draw(src, maxPx, quality) {
  const w = src.width;
  const h = src.height;
  const s = Math.min(1, maxPx / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Returns { mime, base64, thumb } where thumb is a small data URL.
export async function prepareImage(file, maxPx, thumbPx) {
  const src = await decode(file);
  const full = draw(src, maxPx, 0.85);
  const thumb = draw(src, thumbPx, 0.7);
  if (src.close) src.close();
  return { mime: 'image/jpeg', base64: full.split(',')[1], thumb };
}
