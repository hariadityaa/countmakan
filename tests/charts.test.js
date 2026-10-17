import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macroSplit, daySeries, ringSvg, weekChartSvg, dailyAverage, onTarget } from '../js/charts.js';

test('macroSplit weights fat at 9 kcal per gram', () => {
  assert.deepEqual(macroSplit({ protein: 10, carbs: 10, fat: 0 }), { protein: 50, carbs: 50, fat: 0 });
  assert.deepEqual(macroSplit({ protein: 0, carbs: 9, fat: 4 }), { protein: 0, carbs: 50, fat: 50 });
  assert.equal(macroSplit({ protein: 0, carbs: 0, fat: 0 }), null);
});

test('daySeries covers n days oldest first and marks unlogged days', () => {
  const entries = [
    { day: '2026-10-12', items: [{ kcal: 500 }, { kcal: 200 }] },
    { day: '2026-10-12', items: [{ kcal: 100 }] },
    { day: '2026-10-10', items: [] },
    { day: '2026-10-01', items: [{ kcal: 999 }] },
  ];
  const s = daySeries(entries, '2026-10-12', 7);
  assert.deepEqual(s.map((d) => d.day), ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  assert.equal(s[6].kcal, 800);
  assert.equal(s[6].logged, true);
  assert.equal(s[4].logged, true);
  assert.equal(s[5].logged, false);
});

test('daySeries crosses month boundaries', () => {
  assert.deepEqual(daySeries([], '2026-03-02', 3).map((d) => d.day), ['2026-02-28', '2026-03-01', '2026-03-02']);
});

test('ringSvg caps the arc and flags over target', () => {
  assert.doesNotMatch(ringSvg(0, 1800), /ring-val/);
  assert.match(ringSvg(900, 1800), /class="ring-val"/);
  assert.match(ringSvg(2000, 1800), /ring-val over/);
  assert.match(ringSvg(1900, 1800), /class="ring-val"/);
});

test('ringSvg colours the arc by macro split', () => {
  const svg = ringSvg(900, 1800, { protein: 50, carbs: 50, fat: 0 });
  assert.match(svg, /ring-seg protein/);
  assert.match(svg, /ring-seg carbs/);
  assert.doesNotMatch(svg, /ring-seg fat/);
  assert.doesNotMatch(svg, /ring-val/);
});

test('onTarget allows 10% either side of the goal', () => {
  assert.equal(onTarget(2036, 1920), true);
  assert.equal(onTarget(1728, 1920), true);
  assert.equal(onTarget(2113, 1920), false);
  assert.equal(onTarget(1000, 0), false);
});

test('dailyAverage skips today and empty days', () => {
  const entries = [
    { day: '2026-10-17', items: [{ kcal: 5000 }] },
    { day: '2026-10-16', items: [{ kcal: 2000 }] },
    { day: '2026-10-14', items: [{ kcal: 1600 }] },
    { day: '2026-10-09', items: [{ kcal: 900 }] },
  ];
  assert.deepEqual(dailyAverage(entries, '2026-10-17'), { kcal: 1800, days: 2 });
  assert.equal(dailyAverage([{ day: '2026-10-17', items: [{ kcal: 1 }] }], '2026-10-17'), null);
});

test('weekChartSvg draws empty days hollow and escapes labels', () => {
  const series = [
    { day: 'a', logged: true, kcal: 2000, label: 'Mon' },
    { day: 'b', logged: false, kcal: 0, label: '<b>' },
  ];
  const svg = weekChartSvg(series, 1800, 'b');
  assert.match(svg, /wk-bar over/);
  assert.match(svg, /wk-empty/);
  assert.match(svg, /wk-target/);
  assert.doesNotMatch(svg, /<b>/);
  assert.equal((svg.match(/wk-hit/g) || []).length, 2);
});
