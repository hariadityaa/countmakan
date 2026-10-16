import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodKind, foodIconSvg } from '../js/food-icons.js';

const item = (name, kcal = 100) => ({ name, kcal });

test('foodKind matches common hawker foods', () => {
  assert.equal(foodKind([item('Laksa')]), 'noodles');
  assert.equal(foodKind([item('Chicken rice')]), 'rice');
  assert.equal(foodKind([item('Kopi C')]), 'drink');
  assert.equal(foodKind([item('Half-boiled eggs')]), 'egg');
  assert.equal(foodKind([item('Kaya toast')]), 'bread');
  assert.equal(foodKind([item('Scallion nougat cracker')]), 'snack');
  assert.equal(foodKind([item('Orange juice')]), 'drink');
  assert.equal(foodKind([item('Banana')]), 'fruit');
  assert.equal(foodKind([item('Pandan cake')]), 'dessert');
});

test('foodKind checks the biggest item first', () => {
  assert.equal(foodKind([item('Fried egg', 90), item('Pad kra pow', 500), item('White rice', 300)]), 'rice');
});

test('foodKind uses whole words and falls back to text, then a plate', () => {
  assert.equal(foodKind([item('Teaspoon of sugar')]), 'plate');
  assert.equal(foodKind([], 'bowl of mee pok'), 'noodles');
  assert.equal(foodKind([item('Rendang')]), 'plate');
  assert.equal(foodKind(null), 'plate');
});

test('foodIconSvg returns a decorative svg', () => {
  assert.match(foodIconSvg([item('Laksa')]), /^<svg viewBox="0 0 24 24" aria-hidden="true">.+<\/svg>$/);
});
