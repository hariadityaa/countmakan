const NUM_FIELDS = ['grams', 'kcal', 'protein', 'carbs', 'fat'];

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          detail: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          kcal: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'confidence'],
      },
    },
  },
  required: ['items'],
};

export class OutputError extends Error {}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace(',', '.'));
  return NaN;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Accepts the model's text (possibly fenced) or an object.
// Returns { items } with clean numbers, or throws OutputError.
export function parseEstimate(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      obj = JSON.parse(s);
    } catch {
      throw new OutputError('Model output was not valid JSON');
    }
  }
  if (Array.isArray(obj)) obj = { items: obj };
  if (!obj || !Array.isArray(obj.items)) throw new OutputError('Model output has no items list');
  return { items: obj.items.map(normalizeItem).filter(Boolean) };
}

export function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const name = String(it.name ?? '').trim() || 'Unknown item';
  const out = { name };
  const detail = typeof it.detail === 'string' ? it.detail.trim() : '';
  if (detail) out.detail = detail;
  for (const f of NUM_FIELDS) {
    const n = toNum(it[f]);
    out[f] = Number.isFinite(n) && n > 0 ? round1(n) : 0;
  }
  const c = toNum(it.confidence);
  out.confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c > 1 ? c / 100 : c)) : 0.5;
  return out;
}

export function totals(items) {
  const t = { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const it of items || []) for (const f of NUM_FIELDS) t[f] += Number(it[f]) || 0;
  for (const f of NUM_FIELDS) t[f] = round1(t[f]);
  return t;
}

// When grams change, scale energy and macros in proportion.
export function scaleItem(item, newGrams) {
  const g = Math.max(0, toNum(newGrams) || 0);
  if (!item.grams) return { ...item, grams: round1(g) };
  const r = g / item.grams;
  return {
    ...item,
    grams: round1(g),
    kcal: round1(item.kcal * r),
    protein: round1(item.protein * r),
    carbs: round1(item.carbs * r),
    fat: round1(item.fat * r),
  };
}

// Short display name. Drops bracketed notes and anything after the first comma,
// so older verbose names like "Dried shrimp (hae bee), fried" read as "Dried shrimp".
export function shortName(name) {
  const s = String(name ?? '').replace(/\([^)]*\)/g, '').split(',')[0].replace(/\s+/g, ' ').trim();
  return s || String(name ?? '').trim();
}

// List title for a meal: the two biggest items by calories.
// more is how many other items the meal has.
export function mealTitle(items, fallback = 'Meal') {
  const named = (items || []).filter((i) => shortName(i.name));
  if (!named.length) return { title: (fallback || '').trim() || 'Meal', more: 0 };
  const top = [...named].sort((a, b) => (Number(b.kcal) || 0) - (Number(a.kcal) || 0)).slice(0, 2);
  return { title: top.map((i) => shortName(i.name)).join(', '), more: named.length - top.length };
}
