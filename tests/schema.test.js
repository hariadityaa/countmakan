import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEstimate, normalizeItem, totals, scaleItem, shortName, mealTitle, OutputError } from '../js/schema.js';

test('parseEstimate reads plain and fenced JSON', () => {
  const body = '{"items":[{"name":"Nasi lemak","grams":350,"kcal":650,"protein":18,"carbs":80,"fat":28,"confidence":0.8}]}';
  assert.equal(parseEstimate(body).items[0].kcal, 650);
  assert.equal(parseEstimate('```json\n' + body + '\n```').items[0].name, 'Nasi lemak');
});

test('parseEstimate accepts a bare array', () => {
  assert.equal(parseEstimate('[{"name":"egg","kcal":70}]').items.length, 1);
});

test('parseEstimate rejects junk', () => {
  assert.throws(() => parseEstimate('not json'), OutputError);
  assert.throws(() => parseEstimate('{"foo":1}'), OutputError);
});

test('normalizeItem coerces strings, clamps negatives, rounds', () => {
  const it = normalizeItem({ name: ' Tempe ', grams: '30', kcal: '58,4', protein: -1, carbs: null, fat: 3.333, confidence: 85 });
  assert.deepEqual(it, { name: 'Tempe', grams: 30, kcal: 58.4, protein: 0, carbs: 0, fat: 3.3, confidence: 0.85 });
});

test('normalizeItem defaults name and confidence', () => {
  const it = normalizeItem({ kcal: 10 });
  assert.equal(it.name, 'Unknown item');
  assert.equal(it.confidence, 0.5);
  assert.equal(normalizeItem(null), null);
});

test('totals sums each field', () => {
  const t = totals([
    { grams: 200, kcal: 260, protein: 5, carbs: 57, fat: 0.6 },
    { grams: 100, kcal: 250, protein: 25, carbs: 0, fat: 16.1 },
  ]);
  assert.deepEqual(t, { grams: 300, kcal: 510, protein: 30, carbs: 57, fat: 16.7 });
});

test('scaleItem rescales macros with grams', () => {
  const s = scaleItem({ name: 'rice', grams: 200, kcal: 260, protein: 5, carbs: 57, fat: 0.6, confidence: 1 }, 100);
  assert.deepEqual(s, { name: 'rice', grams: 100, kcal: 130, protein: 2.5, carbs: 28.5, fat: 0.3, confidence: 1 });
});

test('scaleItem with zero grams only sets grams', () => {
  const s = scaleItem({ name: 'x', grams: 0, kcal: 50, protein: 1, carbs: 1, fat: 1, confidence: 1 }, 40);
  assert.equal(s.grams, 40);
  assert.equal(s.kcal, 50);
});

test('normalizeItem keeps a non-empty detail only', () => {
  assert.equal(normalizeItem({ name: 'Congee', detail: ' plain ' }).detail, 'plain');
  assert.equal('detail' in normalizeItem({ name: 'Congee', detail: '  ' }), false);
});

test('shortName drops brackets and text after the first comma', () => {
  assert.equal(shortName('Dried shrimp (hae bee), fried'), 'Dried shrimp');
  assert.equal(shortName('Rice porridge (congee), plain'), 'Rice porridge');
  assert.equal(shortName('Teh tarik'), 'Teh tarik');
  assert.equal(shortName('(congee)'), '(congee)');
});

test('mealTitle names the two biggest items and counts the rest', () => {
  const items = [
    { name: 'Scallions, chopped', kcal: 2 },
    { name: 'Congee', kcal: 200 },
    { name: 'You tiao (fried dough stick), cut pieces', kcal: 300 },
    { name: 'Zha cai', kcal: 10 },
  ];
  assert.deepEqual(mealTitle(items), { title: 'You tiao, Congee', more: 2 });
  assert.deepEqual(mealTitle(items.slice(0, 2)), { title: 'Congee, Scallions', more: 0 });
  assert.deepEqual(mealTitle([], 'two eggs'), { title: 'two eggs', more: 0 });
  assert.deepEqual(mealTitle([]), { title: 'Meal', more: 0 });
});
