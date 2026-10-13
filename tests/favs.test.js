import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFavs, saveFavs, cleanFavs, favFromEntry, favRefs, mergeFavs, favKcal } from '../js/favs.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};
const RICE = { name: 'Chicken rice', grams: 350, kcal: 600, protein: 25, carbs: 75, fat: 20, confidence: 0.5 };

test('favourites round-trip through storage', () => {
  const s = mem();
  assert.deepEqual(loadFavs(s), []);
  saveFavs([favFromEntry({ items: [RICE], thumb: 'data:image/jpeg;base64,AA', provider: 'gemini', model: 'm' }, 'f1')], s);
  const [f] = loadFavs(s);
  assert.equal(f.id, 'f1');
  assert.equal(f.name, 'Chicken rice');
  assert.equal(f.items[0].confidence, 1, 'a saved favourite counts as confirmed');
  assert.equal(f.provider, 'gemini');
  assert.equal(favKcal(f), 600);
});

test('loadFavs survives junk storage', () => {
  const s = mem();
  s.setItem('countmakan.favourites', '{not json');
  assert.deepEqual(loadFavs(s), []);
});

test('cleanFavs drops malformed and empty favourites and unsafe thumbs', () => {
  const out = cleanFavs([null, { id: 2, items: [RICE] }, { id: 'a', items: [] }, { id: 'b', items: [RICE], thumb: 'javascript:x' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].thumb, '');
  assert.equal(out[0].name, 'Chicken rice');
  assert.deepEqual(cleanFavs('nope'), []);
});

test('favFromEntry names multi-item meals by the top two', () => {
  const f = favFromEntry({ items: [RICE, { name: 'Egg', kcal: 70 }, { name: 'Tea', kcal: 30 }] }, 'x');
  assert.equal(f.name, 'Chicken rice, Egg +1 more');
});

test('favRefs dedupes by name, prefers newest, skips zero portions and caps', () => {
  const favs = [
    { ts: '2026-01-01', items: [{ ...RICE, kcal: 500 }] },
    { ts: '2026-02-01', items: [{ ...RICE, name: 'chicken rice ' }, { name: 'Water', grams: 250, kcal: 0 }] },
    { ts: '2026-01-15', items: [{ name: 'Kopi', grams: 250, kcal: 120.4 }] },
  ];
  assert.deepEqual(favRefs(favs), [
    { name: 'chicken rice', grams: 350, kcal: 600 },
    { name: 'Kopi', grams: 250, kcal: 120 },
  ]);
  assert.equal(favRefs(favs, 1).length, 1);
});

test('mergeFavs replaces same id and keeps the rest', () => {
  const out = mergeFavs([{ id: 'a', name: 'old' }, { id: 'b' }], [{ id: 'a', name: 'new' }, { id: 'c' }]);
  assert.deepEqual(out.map((f) => f.id), ['a', 'b', 'c']);
  assert.equal(out[0].name, 'new');
});
