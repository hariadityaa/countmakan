// sodium is milligrams. Every other amount is grams, except kcal.
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'fibre', 'sodium'];
const NUM_FIELDS = ['grams', ...NUTRIENTS];
const MAX_CHOICES = 4;

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
          sugar: { type: 'NUMBER' },
          fibre: { type: 'NUMBER' },
          sodium: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'sugar', 'fibre', 'sodium', 'confidence'],
      },
    },
    question: { type: 'STRING' },
    choices: { type: 'ARRAY', items: { type: 'STRING' } },
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
// Returns { items, question?, choices? } with clean values, or throws OutputError.
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
  const out = { items: obj.items.map(normalizeItem).filter(Boolean) };
  const question = typeof obj.question === 'string' ? obj.question.trim() : '';
  if (question) {
    out.question = question;
    out.choices = (Array.isArray(obj.choices) ? obj.choices : [])
      .map((c) => String(c ?? '').trim())
      .filter(Boolean)
      .slice(0, MAX_CHOICES);
  }
  return out;
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
  const t = Object.fromEntries(NUM_FIELDS.map((f) => [f, 0]));
  for (const it of items || []) for (const f of NUM_FIELDS) t[f] += Number(it[f]) || 0;
  for (const f of NUM_FIELDS) t[f] = round1(t[f]);
  return t;
}

// When grams change, scale energy and nutrients in proportion.
export function scaleItem(item, newGrams) {
  const g = Math.max(0, toNum(newGrams) || 0);
  if (!item.grams) return { ...item, grams: round1(g) };
  return { ...scaleBy(item, g / item.grams), grams: round1(g) };
}

// Multiplies the weight and every nutrient by factor. Used by the portion buttons.
export function scaleBy(item, factor) {
  const out = { ...item };
  for (const f of NUM_FIELDS) out[f] = round1((Number(item[f]) || 0) * factor);
  return out;
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
