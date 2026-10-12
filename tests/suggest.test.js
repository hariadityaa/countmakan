import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTargets, validateProfile, goalHint } from '../js/suggest.js';

const woman = { sex: 'female', age: 62, height: 155, weight: 58, activity: 'walking', goal: 'keep' };
const man = { sex: 'male', age: 65, height: 170, weight: 70, activity: 'walking', goal: 'keep' };

test('woman, 62, 155 cm, 58 kg, walks: 1480 kcal', () => {
  // Resting 1077.75, times 1.375 = 1481.9, rounds to 1480.
  const { targets } = suggestTargets(woman);
  assert.deepEqual(targets, { kcal: 1480, protein: 58, fat: 49, carbs: 202, sugar: 37, fibre: 21, sodium: 2000 });
});

test('man, 65, 170 cm, 70 kg, walks: 1980 kcal and 1.2 g/kg protein', () => {
  // Resting 1442.5, times 1.375 = 1983.4, rounds to 1980.
  const { targets, reasons } = suggestTargets(man);
  assert.equal(targets.kcal, 1980);
  assert.equal(targets.protein, 84);
  assert.match(reasons.protein, /65/);
});

test('macros add back up to the calories', () => {
  const t = suggestTargets(man).targets;
  assert.ok(Math.abs(4 * t.protein + 4 * t.carbs + 9 * t.fat - t.kcal) <= 6);
});

test('losing weight takes 500 off but never goes below the floor', () => {
  assert.equal(suggestTargets({ ...woman, goal: 'lose' }).targets.kcal, 1200);
  assert.equal(suggestTargets({ ...man, goal: 'lose' }).targets.kcal, 1500);
  assert.equal(suggestTargets({ ...man, activity: 'exercise', goal: 'lose' }).targets.kcal, 1740);
});

test('gaining weight adds 300', () => {
  assert.equal(suggestTargets({ ...woman, goal: 'gain' }).targets.kcal, 1780);
});

test('validateProfile rejects missing or out-of-range fields', () => {
  assert.throws(() => validateProfile({ ...woman, sex: '' }), /male or female/);
  assert.throws(() => validateProfile({ ...woman, age: 15 }), /age/);
  assert.throws(() => validateProfile({ ...woman, weight: '' }), /weight/);
  assert.throws(() => validateProfile({ ...woman, activity: 'x' }), /active/);
  assert.throws(() => validateProfile({ ...woman, goal: undefined }), /goal/);
  assert.equal(validateProfile({ ...woman, age: '62' }).age, 62);
});

test('goalHint uses the Asian BMI cut-offs', () => {
  assert.equal(goalHint(40, 160).goal, 'gain'); // 15.6
  assert.equal(goalHint(55, 160).goal, 'keep'); // 21.5
  assert.equal(goalHint(65, 160).goal, 'keep'); // 25.4
  assert.equal(goalHint(75, 160).goal, 'lose'); // 29.3
});
