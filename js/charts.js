// Chart helpers. Pure functions that return data or SVG markup strings.
// No DOM access, so they run under node:test.
import { totals } from './schema.js';
import { localDay } from './io.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const r1 = (n) => Math.round(n * 10) / 10;

// Calorie estimates are rough, so a day within 10% of the goal counts as on target.
export const TOLERANCE = 0.1;
export const isOver = (value, target) => target > 0 && value > target * (1 + TOLERANCE);
export const onTarget = (value, target) => target > 0 && Math.abs(value - target) <= target * TOLERANCE;

// Calories per gram for each macro.
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

// Share of macro calories from protein, carbs and fat, as whole percents.
// Returns null when there are no macro calories to split.
export function macroSplit(t) {
  const kcal = Object.fromEntries(Object.entries(KCAL_PER_G).map(([m, k]) => [m, (Number(t[m]) || 0) * k]));
  const sum = kcal.protein + kcal.carbs + kcal.fat;
  if (sum <= 0) return null;
  return Object.fromEntries(Object.entries(kcal).map(([m, v]) => [m, Math.round((v / sum) * 100)]));
}

// One row per day for the n days ending on endDay (a YYYY-MM-DD string), oldest first.
// A day with no entries has logged: false, so charts can tell it apart from zero.
export function daySeries(entries, endDay, n = 7) {
  const byDay = new Map();
  for (const e of entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const end = new Date(`${endDay}T12:00:00`);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const day = localDay(d);
    const list = byDay.get(day) || [];
    out.push({ day, logged: list.length > 0, kcal: totals(list.flatMap((e) => e.items)).kcal });
  }
  return out;
}

// Mean calories over the n days before today, skipping days with no meals.
// Today is left out because it is still in progress. Returns null when nothing was logged.
export function dailyAverage(entries, today, n = 7) {
  const end = new Date(`${today}T12:00:00`);
  end.setDate(end.getDate() - 1);
  const logged = daySeries(entries, localDay(end), n).filter((d) => d.logged);
  if (!logged.length) return null;
  return { kcal: logged.reduce((a, d) => a + d.kcal, 0) / logged.length, days: logged.length };
}

// Progress ring for calories eaten against target.
// split (from macroSplit) colours the arc by each macro's share of calories.
export function ringSvg(value, target, split = null) {
  const R = 50;
  const C = 2 * Math.PI * R;
  const frac = target > 0 ? Math.min(1, value / target) : 0;
  const over = isOver(value, target);
  const seg = (cls, start, len) => `<circle class="${cls}" cx="60" cy="60" r="${R}" stroke-dasharray="${r1(len)} ${r1(C)}" stroke-dashoffset="${r1(-start)}" transform="rotate(-90 60 60)"/>`;
  let arc = '';
  if (frac > 0 && split) {
    // A 1.5-unit gap between segments keeps adjacent colours apart.
    const total = C * frac;
    let start = 0;
    for (const m of Object.keys(KCAL_PER_G)) {
      const len = (total * split[m]) / 100;
      if (len > 0) arc += seg(`ring-seg ${m}`, start, Math.max(0.5, len - 1.5));
      start += len;
    }
  } else if (frac > 0) {
    arc = seg(`ring-val${over ? ' over' : ''}`, 0, C * frac);
  }
  return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true">`
    + `<circle class="ring-track" cx="60" cy="60" r="${R}"/>${arc}</svg>`;
}

// Bar path with 4px rounded top corners and a square base on the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${r1(x)} ${r1(y + h)}V${r1(y + r)}Q${r1(x)} ${r1(y)} ${r1(x + r)} ${r1(y)}`
    + `H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h)}Z`;
}

// Daily calories as bars with a dashed target line.
// series: rows from daySeries, each with an added label (short weekday).
export function weekChartSvg(series, target, today) {
  const W = 320, top = 14, base = 118, left = 4, right = 316;
  const max = Math.max(target * 1.15, ...series.map((s) => s.kcal * 1.05), 1);
  const y = (v) => base - (v / max) * (base - top);
  const slot = (right - left) / series.length;
  const bw = Math.min(28, slot * 0.6);
  const parts = [];
  series.forEach((s, i) => {
    const x = left + slot * i + (slot - bw) / 2;
    const cls = s.day === today ? ' today' : '';
    if (s.logged && s.kcal > 0) {
      const over = isOver(s.kcal, target);
      parts.push(`<path class="wk-bar${over ? ' over' : ''}" d="${barPath(x, y(s.kcal), bw, base - y(s.kcal))}"/>`);
    } else {
      parts.push(`<rect class="wk-empty" x="${r1(x + 0.5)}" y="${base - 12}" width="${r1(bw - 1)}" height="11.5" rx="3"/>`);
    }
    parts.push(`<text class="wk-label${cls}" x="${r1(x + bw / 2)}" y="${base + 18}" text-anchor="middle">${esc(s.label)}</text>`);
    parts.push(`<rect class="wk-hit" data-i="${i}" x="${r1(left + slot * i)}" y="0" width="${r1(slot)}" height="${base + 24}"/>`);
  });
  const ty = r1(y(target));
  return `<svg class="wk" viewBox="0 0 ${W} 142" role="img" aria-label="Calories for the last ${series.length} days">`
    + `<line class="wk-base" x1="${left}" x2="${right}" y1="${base}" y2="${base}"/>`
    + parts.join('')
    + (target > 0 ? `<line class="wk-target" x1="${left}" x2="${right}" y1="${ty}" y2="${ty}"/>` : '')
    + '</svg>';
}
