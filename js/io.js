import { normalizeItem } from './schema.js';
import { cleanFavs } from './favs.js';

// 2 adds favourites. Version 1 files still restore.
export const EXPORT_VERSION = 2;

export function localDay(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildExport(entries, targets, favourites = []) {
  return { app: 'countmakan', version: EXPORT_VERSION, exportedAt: new Date().toISOString(), targets, entries, favourites };
}

// Validates an import file. Returns { entries, targets, favourites } with clean data.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (!data || data.app !== 'countmakan' || !Array.isArray(data.entries)) {
    throw new Error('Not a Makan Meter export');
  }
  const entries = [];
  for (const e of data.entries) {
    if (!e || typeof e.id !== 'string' || !e.ts || Number.isNaN(Date.parse(e.ts))) continue;
    entries.push({
      id: e.id,
      ts: new Date(e.ts).toISOString(),
      day: localDay(e.ts),
      items: (Array.isArray(e.items) ? e.items : []).map(normalizeItem).filter(Boolean),
      provider: typeof e.provider === 'string' ? e.provider : 'manual',
      model: typeof e.model === 'string' ? e.model : '',
      source: typeof e.source === 'string' ? e.source : 'text',
      text: typeof e.text === 'string' ? e.text : '',
      thumb: typeof e.thumb === 'string' && e.thumb.startsWith('data:image/') ? e.thumb : '',
    });
  }
  return {
    entries,
    targets: data.targets && typeof data.targets === 'object' ? data.targets : null,
    favourites: cleanFavs(data.favourites),
  };
}
