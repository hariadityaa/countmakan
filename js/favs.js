// Favourite meals. Logging one again costs no API call.
// Each favourite is { id, name, items, thumb, provider, model, ts }.
// Favourites also ground new estimates: their portions go in the prompt as references.
import { normalizeItem, totals, mealTitle } from './schema.js';
import { MAX_REFS } from './config.js';

const STORE_KEY = 'countmakan.favourites';

export function loadFavs(storage = globalThis.localStorage) {
  try {
    return cleanFavs(JSON.parse(storage.getItem(STORE_KEY)));
  } catch {
    return [];
  }
}

// Throws when storage is full, so the caller can say so.
export function saveFavs(favs, storage = globalThis.localStorage) {
  storage.setItem(STORE_KEY, JSON.stringify(favs));
  return favs;
}

// Drops anything malformed. Used on load and on restore from a copy.
export function cleanFavs(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const f of list) {
    if (!f || typeof f.id !== 'string') continue;
    const items = (Array.isArray(f.items) ? f.items : []).map(normalizeItem).filter(Boolean);
    if (!items.length) continue;
    out.push({
      id: f.id,
      name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : mealTitle(items).title,
      items,
      thumb: typeof f.thumb === 'string' && f.thumb.startsWith('data:image/') ? f.thumb : '',
      provider: typeof f.provider === 'string' ? f.provider : '',
      model: typeof f.model === 'string' ? f.model : '',
      ts: typeof f.ts === 'string' ? f.ts : '',
    });
  }
  return out;
}

// A favourite from a meal being edited. id is reused so the editor can toggle it.
export function favFromEntry(entry, id) {
  const { title, more } = mealTitle(entry.items, entry.text);
  return {
    id,
    name: more ? `${title} +${more} more` : title,
    items: entry.items.map((i) => ({ ...i, confidence: 1 })),
    thumb: entry.thumb || '',
    provider: entry.provider || '',
    model: entry.model || '',
    ts: new Date().toISOString(),
  };
}

// Newest favourites win when two hold the same food name.
export function favRefs(favs, max = MAX_REFS) {
  const seen = new Map();
  const newest = [...favs].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  for (const f of newest) {
    for (const i of f.items) {
      const key = i.name.trim().toLowerCase();
      if (!key || seen.has(key) || !i.grams || !i.kcal) continue;
      seen.set(key, { name: i.name.trim(), grams: Math.round(i.grams), kcal: Math.round(i.kcal) });
    }
  }
  return [...seen.values()].slice(0, max);
}

// Merges restored favourites into the current list. Same id: the restored one wins.
export function mergeFavs(current, incoming) {
  const byId = new Map(current.map((f) => [f.id, f]));
  for (const f of incoming) byId.set(f.id, f);
  return [...byId.values()];
}

export const favKcal = (f) => totals(f.items).kcal;
