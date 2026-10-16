import { CHAIN, DEFAULT_TARGETS, THUMB_MAX_PX, KEEP_MAX_PX, MODEL_MAX_PX, MODEL_JPEG_QUALITY, PROVIDER_LABELS, OPTIONAL_PROVIDERS } from './config.js';
import { estimate, testKey, applyOrder, stepId } from './chain.js';
import { totals, scaleItem, scaleBy, normalizeItem, mealTitle } from './schema.js';
import { loadFavs, saveFavs, favFromEntry, favRefs, mergeFavs, favKcal } from './favs.js';
import { parseSetupFragment, buildSetupLink, loadKeys, saveKeys, maskKey, PROVIDERS } from './keys.js';
import { buildExport, parseImport, localDay } from './io.js';
import { prepareImage } from './image.js';
import { describeFailure, scanSummary, MSG } from './messages.js';
import * as db from './db.js';
import * as health from './health.js';
import { ringSvg, weekChartSvg, daySeries, macroSplit } from './charts.js';
import { suggestTargets, goalHint, ACTIVITY, GOAL_CHOICES } from './suggest.js';

const $ = (sel) => document.querySelector(sel);
const GOALS = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'fibre', 'sodium'];
const GOAL_LABELS = {
  kcal: 'Calories', protein: 'Protein (g)', carbs: 'Carbs (g)', fat: 'Fat (g)',
  sugar: 'Sugar limit (g)', fibre: 'Fibre (g)', sodium: 'Sodium limit (mg)',
};
// Portion buttons: share of the meal as first shown, short label, spoken label.
const PORTIONS = [[0.5, '½', 'Half'], [0.75, '¾', 'Three quarters'], [1, 'All', 'All of it'], [1.5, '1½', 'One and a half'], [2, '2×', 'Double']];
const LOW_CONFIDENCE = 0.6;
const SLOW_MS = 30000;
const UNDO_MS = 8000;

const state = {
  keys: {},
  targets: { ...DEFAULT_TARGETS },
  entries: [],
  photo: null, // { mime, base64, bytes, keep, thumb }
  order: [], // saved provider order, as step ids. Empty means the default CHAIN order.
  photoUrl: '', // object URL for the open entry's full photo
  draft: null, // entry being edited
  favs: [],
  answers: [], // [{ q, a }] for the follow-up question
  abort: null, // AbortController for the running estimate
  health: { waiting: 0, needsSignIn: false, error: '' },
  healthRange: 7, // Days for "Send past meals". Null means all.
  healthBusy: false,
};

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : String(k));
  return n;
}

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const MACRO_KEYS = ['protein', 'carbs', 'fat'];
const MACRO_NAMES = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const dot = (m) => el('span', { class: `dot ${m}`, 'aria-hidden': 'true' });
// "● Protein 12 g · ● Carbs 30 g · ● Fat 8 g", each macro in its own colour.
const macroLine = (t) => MACRO_KEYS.flatMap((m, i) => [i ? ' · ' : '', el('span', { class: 'nowrap' }, dot(m), `${MACRO_NAMES[m]} ${fmt(t[m])} g`)]);
const extraLine = (t) => `Sugar ${fmt(t.sugar)} g · Fibre ${fmt(t.fibre)} g · Sodium ${fmt(t.sodium)} mg`;
const hasKeys = () => PROVIDERS.some((p) => state.keys[p]);

function setStatus(node, msg, isError = false) {
  node.textContent = msg;
  node.classList.toggle('error', isError);
}

const ORDER_KEY = 'countmakan.order';
const chain = () => applyOrder(CHAIN, state.order);

function loadOrder() {
  try {
    const ids = JSON.parse(localStorage.getItem(ORDER_KEY));
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function saveOrder(ids) {
  state.order = ids;
  try {
    if (ids.length) localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    else localStorage.removeItem(ORDER_KEY);
  } catch {
    // Storage blocked. The order still holds until the app closes.
  }
}

function loadTargets() {
  try {
    return { ...DEFAULT_TARGETS, ...JSON.parse(localStorage.getItem('countmakan.targets')) };
  } catch {
    return { ...DEFAULT_TARGETS };
  }
}

// ---------- Toast ----------
let toastTimer;
function toast(text, { action, onAction, ms = 4000 } = {}) {
  clearTimeout(toastTimer);
  $('#toast-text').textContent = text;
  const btn = $('#toast-action');
  btn.hidden = !action;
  btn.textContent = action || '';
  btn.onclick = action
    ? () => {
      hideToast();
      onAction();
    }
    : null;
  $('#toast').hidden = false;
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

// ---------- Setup link ----------
function consumeSetupLink() {
  const keys = parseSetupFragment(location.hash);
  if (!keys) return false;
  state.keys = saveKeys({ ...loadKeys(), ...keys });
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

// ---------- Tabs ----------
function showTab(name) {
  for (const b of document.querySelectorAll('nav button')) {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tab-${name}`;
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

// ---------- Today: which step is showing ----------
// One step at a time: add, compose, loading, failure or editor.
function showStep(step) {
  for (const id of ['add', 'compose', 'loading', 'failure', 'editor']) $(`#${id}`).hidden = id !== step;
  $('#favs').hidden = step !== 'add' || !hasKeys() || !state.favs.length;
  // While waiting, the rest of the app can't be tapped or reached by keyboard.
  const busy = step === 'loading';
  document.body.classList.toggle('is-busy', busy);
  for (const n of [$('header.top'), $('main')]) n.inert = busy;
  if (step === 'add') $('#add').hidden = !hasKeys();
  // Summary and meal list only on the home step, so each step has one job.
  // Before setup, an empty dashboard only adds noise. Restored meals still show.
  const home = step === 'add' && (hasKeys() || state.entries.length > 0);
  $('#summary').hidden = !home;
  $('#health-sync').hidden = !home || !showSyncCard();
  $('#meals').hidden = !home;
  $('#not-set-up').hidden = hasKeys();
  $('#welcome').hidden = !hasKeys() || state.entries.length > 0 || step !== 'add';
}

function resetAdd() {
  state.photo = null;
  state.draft = null;
  state.answers = [];
  $('#preview-img').removeAttribute('src');
  $('#meal-text').value = '';
  $('#compose-error').textContent = '';
  showStep('add');
}

// ---------- Summary ----------
function bar(m, value, target) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = target && value > target;
  return el('div', {},
    el('div', { class: 'bar-label' },
      el('span', {}, dot(m), MACRO_NAMES[m]),
      el('span', {}, `${fmt(value)} g of ${fmt(target)} g`, over ? el('span', { class: 'over-tag' }, ' · over') : null)),
    el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { class: m, style: `width:${pct}%` })));
}

// Sugar, fibre and sodium. Neutral, so the macro colours stay unique.
// isMin marks a goal to reach (fibre), so going past it is not shown as over.
function limitBar(label, value, target, unit, isMin = false) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = !isMin && target && value > target;
  return el('div', {},
    el('div', { class: 'bar-label' },
      el('span', {}, label),
      el('span', {}, `${fmt(value)} ${unit} of ${fmt(target)} ${unit}`, over ? el('span', { class: 'over-tag' }, ' · over') : null)),
    el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${pct}%` })));
}

// One strip split by each macro's share of calories.
function splitStrip(t) {
  const split = macroSplit(t);
  if (!split) return null;
  return el('div', { class: 'split' },
    el('div', { class: 'split-title' }, 'Where your calories came from'),
    el('div', { class: 'split-bar', 'aria-hidden': 'true' },
      MACRO_KEYS.filter((m) => split[m] > 0).map((m) => el('i', { class: m, style: `flex-grow:${split[m]}` }))),
    el('div', { class: 'split-legend' }, MACRO_KEYS.map((m) => el('span', { class: 'nowrap' }, dot(m), `${MACRO_NAMES[m]} ${split[m]}%`))));
}

function renderSummary() {
  const today = localDay(new Date());
  const t = totals(state.entries.filter((e) => e.day === today).flatMap((e) => e.items));
  const goal = state.targets.kcal;
  const left = goal - t.kcal;
  const ring = el('div', { class: 'ring-wrap' },
    el('div', { class: 'ring-center' },
      el('div', { class: 'big-num' }, fmt(t.kcal)),
      el('div', { class: 'ring-unit' }, 'calories')));
  ring.insertAdjacentHTML('afterbegin', ringSvg(t.kcal, goal));
  // splitStrip is null before the first meal. replaceChildren would print it as "null".
  $('#summary').replaceChildren(...[
    el('div', { class: 'muted' }, `Today, ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`),
    el('div', { class: 'hero' }, ring,
      el('div', { class: 'hero-text' },
        el('div', { class: `hero-left${left < 0 ? ' over' : ''}` }, fmt(Math.abs(left))),
        el('div', {}, left >= 0 ? `left of your ${fmt(goal)} goal` : `over your ${fmt(goal)} goal`))),
    splitStrip(t),
    el('div', { class: 'bars' }, MACRO_KEYS.map((m) => bar(m, t[m], state.targets[m]))),
    el('div', { class: 'bars' },
      limitBar('Sugar', t.sugar, state.targets.sugar, 'g'),
      limitBar('Fibre', t.fibre, state.targets.fibre, 'g', true),
      limitBar('Sodium', t.sodium, state.targets.sodium, 'mg')),
  ].filter(Boolean));
}

// ---------- Meal lists ----------
function entryRow(e) {
  const t = totals(e.items);
  const { title, more } = mealTitle(e.items, e.text);
  const time = new Date(e.ts).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  return el('li', {},
    el('button', { type: 'button', class: 'entry', 'aria-label': `${title}${more ? ` and ${more} more` : ''}, ${fmt(t.kcal)} calories, at ${time}. Tap to see all items.`, onclick: () => openEditor(structuredClone(e)) },
      e.thumb ? el('img', { src: e.thumb, alt: '' }) : el('span', { class: 'ph', 'aria-hidden': 'true' }, '–'),
      el('span', { class: 'meta' }, el('span', { class: 'name' }, title), el('span', { class: 'time' }, more ? `${time} · +${more} more` : time)),
      el('span', { class: 'cal' }, fmt(t.kcal), el('small', {}, ' kcal'))));
}

function renderToday() {
  const today = localDay(new Date());
  const list = state.entries.filter((e) => e.day === today);
  $('#today-list').replaceChildren(...(list.length ? list.map(entryRow) : [el('li', { class: 'empty' }, 'No meals yet today. Your first one will show up here.')]));
  renderFavs();
  renderSummary();
  if (!$('#add').hidden || !$('#welcome').hidden || !$('#not-set-up').hidden) showStep('add');
}

// Last 7 days as bars against the calorie goal. Tap a bar for that day.
function weekCard() {
  const today = localDay(new Date());
  const series = daySeries(state.entries, today, 7).map((d) => ({
    ...d, label: new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }),
  }));
  const goal = state.targets.kcal;
  const logged = series.filter((d) => d.logged);
  const avg = logged.length ? logged.reduce((a, d) => a + d.kcal, 0) / logged.length : 0;
  const summary = logged.length
    ? `About ${fmt(avg)} calories a day, on ${logged.length} day${logged.length > 1 ? 's' : ''} with meals.`
    : 'No meals in the last 7 days.';
  const caption = el('p', { class: 'wk-caption', 'aria-live': 'polite' }, summary);
  const describe = (d) => {
    const date = new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    if (!d.logged) return `${date}: no meals saved.`;
    const diff = d.kcal - goal;
    return `${date}: ${fmt(d.kcal)} calories, ${diff > 0 ? `${fmt(diff)} over` : `${fmt(-diff)} under`} your goal.`;
  };
  const chart = el('div', { class: 'wk-wrap' });
  chart.innerHTML = weekChartSvg(series, goal, today);
  let active = null;
  const select = (hit) => {
    active?.classList.remove('active');
    active = hit;
    hit?.classList.add('active');
    caption.textContent = hit ? describe(series[hit.dataset.i]) : summary;
  };
  for (const hit of chart.querySelectorAll('.wk-hit')) {
    hit.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') select(hit); });
    hit.addEventListener('click', () => {
      select(hit);
      document.getElementById(`day-${series[hit.dataset.i].day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  chart.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') select(null); });
  return el('div', { class: 'card' },
    el('h2', {}, 'Last 7 days'),
    chart,
    caption,
    el('div', { class: 'wk-legend' },
      el('span', { class: 'nowrap' }, el('i', { class: 'key under' }), 'Under goal'),
      el('span', { class: 'nowrap' }, el('i', { class: 'key over' }), 'Over goal'),
      el('span', { class: 'nowrap' }, el('i', { class: 'key goal' }), `Goal ${fmt(goal)}`),
      el('span', { class: 'nowrap' }, el('i', { class: 'key none' }), 'No meals')));
}

function renderHistory() {
  const byDay = new Map();
  for (const e of state.entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const cards = [...byDay.entries()].map(([day, list]) => {
    const t = totals(list.flatMap((e) => e.items));
    const label = new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return el('div', { class: 'card', id: `day-${day}` },
      el('div', { class: 'day-head' }, el('h2', {}, label), el('span', { class: 'day-total' }, `${fmt(t.kcal)} calories`)),
      el('div', { class: 'muted' }, macroLine(t)),
      el('ul', { class: 'entries' }, list.map(entryRow)));
  });
  $('#history').replaceChildren(...(cards.length
    ? [weekCard(), ...cards]
    : [el('div', { class: 'card empty' },
      el('p', {}, 'No meals saved yet. Once you save some, you\'ll see a chart of your week here.'),
      el('button', { type: 'button', class: 'btn primary', id: 'history-add', onclick: () => showTab('today') }, 'Add your first meal'))]));
}

// ---------- Favourites ----------
function favRow(f) {
  const kcal = favKcal(f);
  return el('li', {},
    el('button', { type: 'button', class: 'entry', 'aria-label': `${f.name}, ${fmt(kcal)} calories. Tap to add it again.`, onclick: () => logAgain(f) },
      f.thumb ? el('img', { src: f.thumb, alt: '' }) : el('span', { class: 'ph', 'aria-hidden': 'true' }, '★'),
      el('span', { class: 'meta' }, el('span', { class: 'name' }, f.name), el('span', { class: 'time' }, 'Tap to add again')),
      el('span', { class: 'cal' }, fmt(kcal), el('small', {}, ' kcal'))));
}

function renderFavs() {
  $('#fav-list').replaceChildren(...state.favs.map(favRow));
}

// Starts a new meal from a favourite or a past meal. No API call.
function logAgain(src) {
  openEditor({
    id: uid(),
    ts: new Date().toISOString(),
    items: structuredClone(src.items),
    provider: src.provider || '',
    model: src.model || '',
    source: 'repeat',
    text: src.text || '',
    thumb: src.thumb || '',
    favId: state.favs.some((f) => f.id === src.id) ? src.id : src.favId,
    isNew: true,
  });
}

function toggleFav() {
  const d = state.draft;
  const had = state.favs.some((f) => f.id === d.favId);
  const next = had ? state.favs.filter((f) => f.id !== d.favId) : [favFromEntry(d, d.favId || uid()), ...state.favs];
  try {
    state.favs = saveFavs(next);
  } catch {
    toast('The phone is full. Remove a favourite first.');
    return;
  }
  d.favId = had ? undefined : next[0].id;
  renderFavs();
  renderEditor();
  toast(had ? 'Removed from favourites.' : 'Saved as a favourite ★');
}

// ---------- Add a meal ----------
async function onPhoto(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    state.photo = await prepareImage(file, THUMB_MAX_PX, KEEP_MAX_PX, MODEL_MAX_PX, MODEL_JPEG_QUALITY);
  } catch {
    showStep(state.photo ? 'compose' : 'add');
    toast(MSG.photo);
    return;
  }
  $('#preview-img').src = `data:${state.photo.mime};base64,${state.photo.base64}`;
  openCompose(true);
}

function openCompose(withPhoto) {
  if (!withPhoto) {
    state.photo = null;
    $('#preview-img').removeAttribute('src');
  }
  $('#compose-title').textContent = withPhoto ? 'Is this the right photo?' : 'What did you eat?';
  $('#preview-img').hidden = !withPhoto;
  $('#choose-another').hidden = !withPhoto;
  $('#meal-text-label').textContent = withPhoto ? 'Anything to add? (optional)' : 'Describe your food';
  $('#meal-text').placeholder = withPhoto ? 'For example: half a plate of rice' : 'For example: nasi goreng with a fried egg';
  $('#compose-error').textContent = '';
  showStep('compose');
  if (!withPhoto) $('#meal-text').focus();
}

function setLoading(text, hint) {
  $('#loading-text').textContent = text;
  $('#loading-hint').textContent = hint;
}

// Each step reflects a real event: request sent, waiting for the answer, answer shown.
function setStep(id, status, label) {
  const li = $(`#step-${id}`);
  li.className = status;
  if (label) li.querySelector('.label').textContent = label;
}

// Keeps the phone from locking mid-wait, which can pause the request.
async function keepAwake() {
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return null; // Not supported, or refused. The wait still works.
  }
}

// Count calories on the compose step starts fresh. Try again keeps any follow-up answer.
function onEstimate() {
  state.answers = [];
  runEstimate();
}

async function runEstimate() {
  const text = $('#meal-text').value.trim();
  if (!state.photo && !text) {
    showStep('compose');
    $('#compose-error').textContent = 'Please type what you ate.';
    return;
  }
  const photo = !!state.photo;
  const img = $('#loading-img');
  if (photo) img.src = `data:${state.photo.mime};base64,${state.photo.base64}`;
  else img.removeAttribute('src');
  $('#loading-photo').hidden = !photo;
  setLoading('Counting calories…', 'This usually takes under 30 seconds.');
  setStep('sent', 'now', photo ? 'Sending your photo' : 'Sending your description');
  setStep('look', 'todo', photo ? 'Looking at your food' : 'Reading your description');
  setStep('done', 'todo');
  $('#elapsed').textContent = '0';
  showStep('loading');
  $('#cancel-estimate').focus();

  const abort = new AbortController();
  state.abort = abort;
  const started = performance.now();
  const tick = setInterval(() => { $('#elapsed').textContent = String(Math.round((performance.now() - started) / 1000)); }, 1000);
  const slow = setTimeout(() => setLoading('Still working…', "Sorry for the wait. It's still going."), SLOW_MS);
  const lock = await keepAwake();
  try {
    const input = {
      text,
      image: photo ? { mime: state.photo.mime, base64: state.photo.base64 } : null,
      answers: state.answers,
      refs: favRefs(state.favs),
    };
    const out = await estimate(input, state.keys, {
      chain: chain(),
      signal: abort.signal,
      onAttempt: (_step, i) => {
        setStep('sent', 'done', photo ? 'Photo sent' : 'Description sent');
        setStep('look', 'now');
        if (i > 0) {
          setStep('look', 'now', 'Trying another way…');
          setLoading('Still working…', 'This can take up to a minute.');
        }
      },
    });
    const scan = scanSummary(out.attempts, { photoBytes: photo ? state.photo.bytes : 0, usage: out.usage });
    console.info(`Scan: ${scan}`);
    if (!out.items.length) {
      showFailure({ text: MSG.noFood, details: `${out.model}: returned no items\n${scan}` });
      return;
    }
    // One follow-up round at most, and only when something is uncertain.
    const unsure = out.items.some((i) => i.confidence < LOW_CONFIDENCE);
    const ask = out.question && unsure && !state.answers.length ? { question: out.question, choices: out.choices || [] } : null;
    openEditor({
      id: uid(),
      ts: state.draft?.isNew ? state.draft.ts : new Date().toISOString(),
      items: out.items,
      ask,
      provider: out.provider,
      model: out.model,
      usage: out.usage,
      ms: Math.round(performance.now() - started),
      scan,
      source: photo ? 'photo' : 'text',
      text,
      thumb: state.photo?.thumb || '',
      photo: state.photo?.keep || null,
      isNew: true,
    });
  } catch (e) {
    if (abort.signal.aborted) return; // Stop already moved the screen back.
    const failure = describeFailure(e, navigator.onLine);
    console.info(`Scan failed:\n${failure.details}`);
    showFailure(failure);
  } finally {
    clearTimeout(slow);
    clearInterval(tick);
    lock?.release().catch(() => {});
    if (state.abort === abort) state.abort = null;
  }
}

function cancelEstimate() {
  state.abort?.abort();
  state.abort = null;
  // Stopping a follow-up goes back to the first answer, which is still there.
  if (state.answers.length && state.draft) {
    state.answers = [];
    showStep('editor');
    return;
  }
  showStep('compose');
}

function answerQuestion(a) {
  const answer = String(a || '').trim();
  if (!answer) return;
  state.answers = [{ q: state.draft.ask.question, a: answer }];
  runEstimate();
}

function showFailure({ text, details }) {
  $('#failure-text').textContent = text;
  $('#failure-details').textContent = details;
  $('#failure details').open = false;
  showStep('failure');
  $('#failure').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Editor ----------
function toLocalInput(iso) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function openEditor(entry) {
  // base is the meal at "All". The portion buttons scale from it, so taps never compound.
  entry.portion = 1;
  entry.base = structuredClone(entry.items);
  state.draft = entry;
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = entry.photo ? URL.createObjectURL(entry.photo) : '';
  showTab('today');
  renderEditor();
  showStep('editor');
  $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  state.draft = null;
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = '';
  $('#editor').replaceChildren();
  resetAdd();
}

function field(id, label, value, onChange, cls = '') {
  return el('div', { class: cls },
    el('label', { for: id }, label),
    el('input', { id, type: 'number', inputmode: 'decimal', min: '0', step: 'any', value, onchange: (ev) => onChange(ev.target.value) }));
}

// Replacing a focused input fires blur, then change, which would re-enter here.
let rendering = false;
function renderEditor() {
  if (rendering) return;
  rendering = true;
  try {
    drawEditor();
  } finally {
    rendering = false;
  }
}

function drawEditor() {
  const d = state.draft;
  const items = d.items.map((it, i) => {
    const update = (f) => (v) => {
      d.items[i] = f === 'grams' ? scaleItem(it, v) : normalizeItem({ ...it, [f]: v });
      d.base[i] = scaleBy(d.items[i], 1 / d.portion);
      renderEditor();
    };
    const id = (f) => `item-${i}-${f}`;
    return el('div', { class: 'item' },
      el('label', { for: id('name') }, 'Food'),
      el('input', { id: id('name'), value: it.name, onchange: (ev) => { d.items[i] = { ...it, name: ev.target.value }; d.base[i] = { ...d.base[i], name: ev.target.value }; } }),
      it.detail ? el('div', { class: 'item-detail' }, it.detail) : null,
      it.confidence < LOW_CONFIDENCE ? el('span', { class: 'badge' }, 'Please check this') : null,
      el('div', { class: 'item-cals' },
        field(id('grams'), 'Grams', it.grams, update('grams')),
        field(id('kcal'), 'Calories', it.kcal, update('kcal'))),
      el('div', { class: 'item-macros' },
        field(id('protein'), 'Protein g', it.protein, update('protein'), 'm-protein'),
        field(id('carbs'), 'Carbs g', it.carbs, update('carbs'), 'm-carbs'),
        field(id('fat'), 'Fat g', it.fat, update('fat'), 'm-fat')),
      el('div', { class: 'item-macros' },
        field(id('sugar'), 'Sugar g', it.sugar, update('sugar')),
        field(id('fibre'), 'Fibre g', it.fibre, update('fibre')),
        field(id('sodium'), 'Sodium mg', it.sodium, update('sodium'))),
      el('button', { type: 'button', class: 'btn danger', 'aria-label': `Remove this food: ${it.name}`, onclick: () => { d.items.splice(i, 1); d.base.splice(i, 1); renderEditor(); } }, 'Remove this food'));
  });
  const t = totals(d.items);
  const isFav = state.favs.some((f) => f.id === d.favId);
  $('#editor').replaceChildren(...[
    el('h2', {}, d.isNew ? "Here's what we found" : 'Change this meal'),
    state.photoUrl || d.thumb ? el('img', { class: 'editor-photo', src: state.photoUrl || d.thumb, alt: 'Your meal' }) : null,
    d.ask ? questionCard(d.ask) : null,
    el('p', { class: 'muted' }, 'If a portion looks wrong, change the grams. The other numbers update by themselves.'),
    items.length ? items : el('p', { class: 'empty' }, 'No food in this meal. Add one below.'),
    el('button', { type: 'button', class: 'btn', onclick: () => { const it = normalizeItem({ name: 'Food', confidence: 1 }); d.items.push(it); d.base.push(scaleBy(it, 1 / d.portion)); renderEditor(); } }, '+ Add another food'),
    items.length ? portionRow(d) : null,
    el('p', { class: 'total', id: 'editor-total' }, `Total: ${fmt(t.kcal)} calories`),
    el('p', { class: 'total-sub' }, macroLine(t)),
    el('p', { class: 'total-sub', id: 'editor-extra' }, extraLine(t)),
    el('label', { for: 'entry-time' }, 'Time eaten'),
    el('input', { id: 'entry-time', type: 'datetime-local', value: toLocalInput(d.ts), onchange: (ev) => { if (ev.target.value) d.ts = new Date(ev.target.value).toISOString(); } }),
    el('button', { type: 'button', class: 'btn primary', id: 'save-meal', onclick: saveDraft }, d.isNew ? 'Save meal' : 'Save changes'),
    el('button', { type: 'button', class: 'btn', onclick: closeEditor }, d.isNew ? "Don't save" : 'Cancel'),
    items.length ? el('button', { type: 'button', class: 'btn', id: 'fav-toggle', 'aria-pressed': String(isFav), onclick: toggleFav }, isFav ? '★ Remove from favourites' : '☆ Save as a favourite') : null,
    d.isNew ? null : el('button', { type: 'button', class: 'btn', id: 'eat-again', onclick: () => logAgain(d) }, 'I ate this again'),
    d.isNew ? null : el('button', { type: 'button', class: 'btn danger', onclick: deleteDraft }, 'Delete this meal'),
    d.scan ? el('p', { class: 'muted scan-details', id: 'scan-details' }, `Scan: ${d.scan}`) : null,
  ].flat().filter(Boolean));
}

function portionRow(d) {
  return el('div', { class: 'portion' },
    el('p', { class: 'portion-label', id: 'portion-label' }, d.isNew ? 'How much did you eat?' : 'Change the amount'),
    el('div', { class: 'portion-btns', role: 'group', 'aria-labelledby': 'portion-label' },
      PORTIONS.map(([p, label, spoken]) => el('button', {
        type: 'button',
        class: 'btn',
        'aria-pressed': String(d.portion === p),
        'aria-label': spoken,
        onclick: () => {
          d.portion = p;
          d.items = d.base.map((it) => scaleBy(it, p));
          renderEditor();
        },
      }, label))));
}

function questionCard(ask) {
  const other = el('input', { id: 'ask-other', placeholder: 'Or type your answer', enterkeyhint: 'send' });
  other.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') answerQuestion(other.value); });
  return el('div', { class: 'ask', id: 'ask' },
    el('p', { class: 'ask-title' }, 'One quick question'),
    el('p', { class: 'ask-q' }, ask.question),
    el('div', { class: 'ask-choices' }, ask.choices.map((c) => el('button', { type: 'button', class: 'btn', onclick: () => answerQuestion(c) }, c))),
    el('label', { for: 'ask-other' }, 'Something else?'),
    other,
    el('button', { type: 'button', class: 'btn', onclick: () => answerQuestion(other.value) }, 'Send answer'),
    el('p', { class: 'muted' }, 'Not sure? Skip this and save.'));
}

async function saveDraft() {
  // Commit an edit that is still focused, so its change event runs first.
  document.activeElement?.blur?.();
  const { isNew, ...entry } = state.draft;
  // Editor-only state. Not saved.
  for (const k of ['ask', 'base', 'portion']) delete entry[k];
  entry.day = localDay(entry.ts);
  entry.updatedAt = new Date().toISOString();
  const prev = state.entries.find((x) => x.id === entry.id);
  if (isNew ? health.isOn() : prev?.gh) {
    // Custom food logs can't be edited, so an edit replaces the old log.
    if (prev?.gh?.name) health.queueDelete(prev.gh.name, { ripeNow: true });
    entry.gh = { state: 'pending' };
  }
  await db.putEntry(entry);
  state.entries = await db.allEntries();
  closeEditor();
  renderToday();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(isNew ? 'Meal saved ✓' : 'Changes saved ✓');
  syncHealth();
}

async function deleteDraft() {
  const id = state.draft.id;
  const saved = state.entries.find((e) => e.id === id);
  if (saved?.gh?.name) {
    health.queueDelete(saved.gh.name);
    setTimeout(syncHealth, health.DELETE_DELAY_MS + 500);
  }
  await db.deleteEntry(id);
  state.entries = await db.allEntries();
  closeEditor();
  renderToday();
  toast('Meal deleted.', {
    action: 'Undo',
    ms: UNDO_MS,
    onAction: async () => {
      // If the remote delete already went out, send the meal again.
      const name = saved.gh?.name;
      await db.putEntry(name && !health.unqueueDelete(name) ? { ...saved, gh: { state: 'pending' } } : saved);
      state.entries = await db.allEntries();
      renderToday();
      if (!$('#tab-history').hidden) renderHistory();
      toast('Meal is back ✓');
      syncHealth();
    },
  });
}

// ---------- Google Health ----------
const showSyncCard = () => health.isOn() && state.health.needsSignIn && state.health.waiting > 0;
const changes = (n) => (n === 1 ? '1 meal is' : `${n} meals are`);
const meals = (n) => (n === 1 ? '1 meal' : `${n} meals`);
const RANGES = [[7, '7 days'], [30, '30 days'], [null, 'All']];

async function syncHealth() {
  if (!health.isOn()) return;
  state.health = await health.sync({
    entries: state.entries,
    save: async (e) => {
      if (!(await db.getEntry(e.id))) return false;
      await db.putEntry(e);
      return true;
    },
    onProgress: (waiting) => {
      state.health = { ...state.health, waiting };
      renderHealth();
    },
  });
  state.entries = await db.allEntries();
  renderHealth();
}

function renderHealth() {
  const { waiting, error } = state.health;
  $('#health-sync-text').textContent = `${changes(waiting)} not in Google Health yet.`;
  $('#health-sync').hidden = $('#summary').hidden || !showSyncCard();
  const connected = health.isConnected();
  const on = health.isOn();
  const failed = state.entries.filter((e) => e.gh?.state === 'failed').length;
  const held = health.waitingCount(state.entries);
  const lines = !connected
    ? ['Send each new meal to the Google Health app.']
    : on
      ? [state.healthBusy && waiting ? `Sending. ${changes(waiting)} left.` : 'On. New meals also go to the Google Health app.',
        !state.healthBusy && waiting ? `${changes(waiting)} waiting to send.` : '',
        failed ? `${meals(failed)} could not be sent.` : '',
        error ? `Last try failed: ${error}` : '']
      : ['Off. New meals stay in this app only.',
        held ? `${held === 1 ? '1 change waits' : `${held} changes wait`} until you turn it back on.` : ''];
  $('#health-status').textContent = lines.filter(Boolean).join(' ');
  $('#health-on-row').hidden = !connected;
  $('#health-on').checked = on;
  $('#health-connect').hidden = connected;
  $('#health-disconnect').hidden = !connected;
  renderPastMeals(on);
}

function renderPastMeals(on) {
  const all = health.unsent(state.entries, null).length;
  $('#health-past').hidden = !on || (!all && !state.healthBusy);
  if ($('#health-past').hidden) return;
  const n = health.unsent(state.entries, state.healthRange).length;
  $('#health-range').replaceChildren(...RANGES.map(([days, label]) => el('button', {
    type: 'button',
    class: 'btn',
    'aria-pressed': String(state.healthRange === days),
    onclick: () => { state.healthRange = days; renderHealth(); },
  }, label)));
  const span = state.healthRange ? `in the last ${state.healthRange} days` : 'in total';
  $('#health-past-text').textContent = n ? `${meals(n)} ${span} not sent yet.` : `No unsent meals ${span}.`;
  const btn = $('#health-past-btn');
  btn.textContent = state.healthBusy ? 'Sending…' : n ? `Send ${meals(n)}` : 'Send past meals';
  btn.disabled = state.healthBusy || !n;
}

// Signs in only when the token has run out. A tap counts as the user gesture for the popup.
async function sendNow() {
  if (!health.validToken()) {
    try {
      await health.getToken();
    } catch (e) {
      toast(`Google Health: ${e.message}`);
      return false;
    }
  }
  await syncHealth();
  return true;
}

async function onHealthSignIn(okText) {
  try {
    await health.getToken();
  } catch (e) {
    toast(`Google Health: ${e.message}`);
    return;
  }
  await syncHealth();
  toast(state.health.error ? `Google Health: ${state.health.error}` : okText);
}

async function onHealthSendCard() {
  if (!(await sendNow())) return;
  toast(state.health.error ? `Google Health: ${state.health.error}` : 'Sent to Google Health ✓');
}

async function onHealthToggle(ev) {
  const on = ev.target.checked;
  health.setPaused(!on);
  if (!on) {
    state.health = { waiting: 0, needsSignIn: false, error: '' };
    renderHealth();
    toast('Google Health sync is off.');
    return;
  }
  renderHealth();
  if (health.waitingCount(state.entries) && !(await sendNow())) return;
  toast(state.health.error ? `Google Health: ${state.health.error}` : 'Google Health sync is on ✓');
}

async function onSendPastMeals() {
  const list = health.unsent(state.entries, state.healthRange);
  if (!list.length || state.healthBusy) return;
  state.healthBusy = true;
  await db.putMany(list.map((e) => ({ ...e, gh: { state: 'pending' } })));
  state.entries = await db.allEntries();
  renderHealth();
  try {
    if (!(await sendNow())) return;
    // A sync already running holds the old list, so one more pass picks up the rest.
    if (state.health.waiting && !state.health.error && !state.health.needsSignIn) await syncHealth();
  } finally {
    state.healthBusy = false;
    renderHealth();
  }
  const { waiting, error } = state.health;
  const ids = new Set(list.map((e) => e.id));
  const sent = state.entries.filter((e) => ids.has(e.id) && e.gh?.state === 'done').length;
  const failed = state.entries.filter((e) => ids.has(e.id) && e.gh?.state === 'failed').length;
  if (error) toast(`Google Health: ${error}`);
  else if (waiting) toast(`${changes(waiting)} still waiting. Try again soon.`);
  else if (failed) toast(`Sent ${meals(sent)}. ${meals(failed)} could not be sent.`);
  else toast(`Sent ${meals(sent)} to Google Health ✓`);
}

function onHealthDisconnect() {
  health.disconnect();
  state.health = { waiting: 0, needsSignIn: false, error: '' };
  renderHealth();
  toast('Google Health is off.');
}

// ---------- Settings ----------
function renderSettings() {
  $('#key-gemini').value = state.keys.gemini || '';
  $('#key-deepseek').value = state.keys.deepseek || '';
  $('#key-results').replaceChildren(...PROVIDERS.map((p) => el('li', {}, `${PROVIDER_LABELS[p]}: ${maskKey(state.keys[p])}`)));
  $('#targets').replaceChildren(...GOALS.map((m) => el('div', {},
    el('label', { for: `t-${m}` }, GOAL_LABELS[m]),
    el('input', { id: `t-${m}`, type: 'number', inputmode: 'numeric', min: '0', value: state.targets[m] }))));
  syncSaveTargets();
  health.preload().catch(() => {});
  renderHealth();
  if (!state.keys.gemini) $('#gemini-guide').open = true;
  if (state.keys.deepseek) $('#deepseek-section').open = true;
  renderChain();
}

// Provider order: tried top to bottom. Up and down buttons move a step.
function renderChain() {
  const list = chain();
  const move = (i, by) => {
    const ids = list.map(stepId);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    saveOrder(ids);
    renderChain();
    // Keep focus on the moved step. At the top or bottom its other button takes it.
    const moved = ids[i + by];
    ($(`#chain [data-move="${by}"][data-step="${moved}"]:not([disabled])`) || $(`#chain [data-step="${moved}"]:not([disabled])`))?.focus();
  };
  $('#chain').replaceChildren(...list.map((s, i) => {
    const name = `${PROVIDER_LABELS[s.provider]} · ${s.model}`;
    return el('li', { class: 'chain-step' },
      el('span', {}, `${name}${keyNote(s.provider)}`),
      el('span', { class: 'chain-btns' },
        el('button', { type: 'button', class: 'btn', 'data-move': '-1', 'data-step': stepId(s), 'aria-label': `Move ${name} up`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        el('button', { type: 'button', class: 'btn', 'data-move': '1', 'data-step': stepId(s), 'aria-label': `Move ${name} down`, disabled: i === list.length - 1, onclick: () => move(i, 1) }, '↓')));
  }));
  $('#reset-order').hidden = !state.order.length;
}

function keyNote(p) {
  if (state.keys[p]) return '';
  return OPTIONAL_PROVIDERS.includes(p) ? ' (optional, no key)' : ' (no key)';
}

// Not-set-up card: jump straight to Setup with the key guide open.
function openOwnKeySetup() {
  showTab('settings');
  $('#setup').open = true;
  $('#gemini-guide').open = true;
  $('#setup').scrollIntoView({ block: 'start' });
}

function readKeyInputs() {
  return { gemini: $('#key-gemini').value, deepseek: $('#key-deepseek').value };
}

async function onTestKeys() {
  const keys = readKeyInputs();
  const out = $('#key-results');
  out.replaceChildren(el('li', {}, 'Testing…'));
  const rows = await Promise.all(PROVIDERS.map(async (p) => {
    if (!keys[p]) return el('li', {}, `${PROVIDER_LABELS[p]}: not set${OPTIONAL_PROVIDERS.includes(p) ? ' (optional)' : ''}`);
    const r = await testKey(p, keys[p].trim());
    return el('li', {}, `${r.ok ? '✓' : '✕'} ${PROVIDER_LABELS[p]}: ${r.message}`);
  }));
  out.replaceChildren(...rows);
}

async function onMakeLink() {
  const link = buildSetupLink(location.href, readKeyInputs());
  try {
    await navigator.clipboard.writeText(link);
    toast('Setup link copied. Send it privately.');
  } catch {
    prompt('Copy this setup link:', link);
  }
}

function onSaveTargets() {
  for (const m of GOALS) {
    const v = Number($(`#t-${m}`).value);
    if (v > 0) state.targets[m] = v;
  }
  localStorage.setItem('countmakan.targets', JSON.stringify(state.targets));
  for (const i of document.querySelectorAll('#targets input')) i.classList.remove('suggested');
  renderSummary();
  syncSaveTargets();
  toast('Goals saved ✓');
}

// Save is only live when a box differs from the saved goals. Otherwise it reads "Saved ✓".
// Mirrors onSaveTargets: a blank or zero box is ignored, so it doesn't count as a change.
function syncSaveTargets() {
  const dirty = GOALS.some((m) => {
    const v = Number($(`#t-${m}`).value);
    return v > 0 && v !== state.targets[m];
  });
  const btn = $('#save-targets');
  btn.disabled = !dirty;
  btn.classList.toggle('primary', dirty);
  btn.textContent = dirty ? 'Save goals' : 'Saved ✓';
}

// ---------- Suggest goals ----------
const PROFILE_FIELDS = ['sex', 'age', 'height', 'weight', 'activity', 'goal'];
const SUGGEST_NAMES = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', sugar: 'Sugar', fibre: 'Fibre', sodium: 'Sodium' };

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('countmakan.profile')) || {};
  } catch {
    return {};
  }
}

function readProfile() {
  return Object.fromEntries(PROFILE_FIELDS.map((f) => [f, $(`#p-${f}`).value]));
}

function renderSuggestForm() {
  const opts = (map) => [el('option', { value: '' }, 'Choose'), ...Object.entries(map).map(([k, v]) => el('option', { value: k }, v.label))];
  $('#p-activity').replaceChildren(...opts(ACTIVITY));
  $('#p-goal').replaceChildren(...opts(GOAL_CHOICES));
  const p = loadProfile();
  for (const f of PROFILE_FIELDS) if (p[f] != null) $(`#p-${f}`).value = p[f];
  updateGoalHint();
}

// Shows a BMI hint and pre-picks the goal only while the user hasn't chosen one.
function updateGoalHint() {
  const w = Number($('#p-weight').value);
  const h = Number($('#p-height').value);
  if (!(w > 0 && h > 0)) {
    $('#p-hint').textContent = '';
    return;
  }
  const hint = goalHint(w, h);
  $('#p-hint').textContent = hint.text;
  if (!$('#p-goal').value) $('#p-goal').value = hint.goal;
}

// Fills the goal boxes but does not save. The user can change any number, then taps Save goals.
function onSuggest() {
  const profile = readProfile();
  try {
    const { targets, reasons } = suggestTargets(profile);
    localStorage.setItem('countmakan.profile', JSON.stringify(profile));
    for (const m of GOALS) {
      const input = $(`#t-${m}`);
      input.value = targets[m];
      input.classList.add('suggested');
    }
    syncSaveTargets();
    $('#suggest-reasons').replaceChildren(...GOALS.map((m) => el('li', {}, `${SUGGEST_NAMES[m]} ${fmt(targets[m])} ${m === 'kcal' ? 'kcal' : m === 'sodium' ? 'mg' : 'g'}: ${reasons[m]}`)));
    setStatus($('#suggest-status'), 'Numbers filled in above. Change any of them, then tap Save goals.');
    $('#targets').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    $('#suggest-reasons').replaceChildren();
    setStatus($('#suggest-status'), e.message, true);
  }
}

function onExport() {
  const data = buildExport(state.entries, state.targets, state.favs);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `makan-meter-${localDay(new Date())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus($('#io-status'), `Saved a copy of ${data.entries.length} meals.`);
}

async function onImport(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const { entries, targets, favourites } = parseImport(await file.text());
    await db.putMany(entries);
    if (favourites.length) state.favs = saveFavs(mergeFavs(state.favs, favourites));
    if (targets) {
      state.targets = { ...state.targets, ...targets };
      localStorage.setItem('countmakan.targets', JSON.stringify(state.targets));
    }
    state.entries = await db.allEntries();
    renderToday();
    renderSettings();
    setStatus($('#io-status'), `Restored ${entries.length} meals.`);
  } catch {
    setStatus($('#io-status'), "That file isn't a Makan Meter copy. Choose another file.", true);
  }
}

// ---------- Install ----------
// Chrome's menu install says "already installed" for any page on an origin that has an
// installed app (turisfasih on hurrymeow.github.io). The page prompt checks scope correctly.
let installEvent = null;
const INSTALL_DECLINED = 'countmakan.installDeclined';
const isStandalone = () => matchMedia('(display-mode: standalone)').matches;

function renderInstall() {
  let declined = false;
  try { declined = localStorage.getItem(INSTALL_DECLINED) === '1'; } catch { /* storage blocked */ }
  $('#install').hidden = !installEvent || declined || isStandalone();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => { installEvent = null; renderInstall(); });

async function onInstall() {
  const e = installEvent;
  installEvent = null;
  renderInstall();
  if (e) await e.prompt().catch(() => {});
}

function onDeclineInstall() {
  try { localStorage.setItem(INSTALL_DECLINED, '1'); } catch { /* storage blocked */ }
  renderInstall();
}

// ---------- Share ----------
// Installed apps hide the address bar, so this is the only way to find the link.
async function onShareApp() {
  const url = new URL('./', location.href).href;
  if (navigator.share) {
    try { await navigator.share({ title: document.title, url }); return; }
    catch (err) { if (err && err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied.'); }
  catch { toast(url); }
}

// ---------- Boot ----------
async function boot() {
  const fromLink = consumeSetupLink();
  state.keys = loadKeys();
  state.targets = loadTargets();
  state.order = loadOrder();
  state.entries = await db.allEntries();
  state.favs = loadFavs();

  for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  for (const id of ['#camera', '#upload', '#replace']) $(id).addEventListener('change', onPhoto);
  $('#type-meal').addEventListener('click', () => openCompose(false));
  $('#cancel-compose').addEventListener('click', resetAdd);
  $('#estimate').addEventListener('click', onEstimate);
  $('#cancel-estimate').addEventListener('click', cancelEstimate);
  $('#retry').addEventListener('click', () => runEstimate());
  $('#start-over').addEventListener('click', resetAdd);
  $('#save-keys').addEventListener('click', () => {
    state.keys = saveKeys(readKeyInputs());
    renderSettings();
    showStep('add');
    toast('Keys saved ✓');
  });
  $('#test-keys').addEventListener('click', onTestKeys);
  $('#make-link').addEventListener('click', onMakeLink);
  $('#reset-order').addEventListener('click', () => { saveOrder([]); renderChain(); toast('Provider order reset.'); });
  $('#own-key').addEventListener('click', openOwnKeySetup);
  $('#save-targets').addEventListener('click', onSaveTargets);
  $('#targets').addEventListener('input', syncSaveTargets);
  $('#suggest-btn').addEventListener('click', onSuggest);
  $('#p-weight').addEventListener('input', updateGoalHint);
  $('#p-height').addEventListener('input', updateGoalHint);
  renderSuggestForm();
  $('#export').addEventListener('click', onExport);
  $('#import').addEventListener('change', onImport);
  $('#install-yes').addEventListener('click', onInstall);
  $('#install-no').addEventListener('click', onDeclineInstall);
  $('#share-app').addEventListener('click', onShareApp);
  $('#health-connect').addEventListener('click', () => onHealthSignIn('Connected to Google Health ✓'));
  $('#health-disconnect').addEventListener('click', onHealthDisconnect);
  $('#health-on').addEventListener('change', onHealthToggle);
  $('#health-past-btn').addEventListener('click', onSendPastMeals);
  $('#health-sync-btn').addEventListener('click', onHealthSendCard);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncHealth(); });
  renderInstall();

  showStep('add');
  renderToday();
  document.body.dataset.ready = '1';
  if (health.isOn()) {
    health.preload().catch(() => {});
    syncHealth();
  }
  if (fromLink) toast("You're all set. Take a photo of your food to start.", { ms: 6000 });

  watchForUpdates();
}

// ---------- Updates ----------
// A new deploy ships a new sw.js. It installs, takes over at once and fires
// controllerchange. The open page still runs the old code, so offer a reload.
// The installed app can sit in the background for days, so check on return.
const UPDATE_CHECK_MS = 30 * 60 * 1000;
function watchForUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // The first install also fires controllerchange. That is not an update.
  let hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (hadController) $('#update').hidden = false;
    hadController = true;
  });
  $('#update-btn').addEventListener('click', () => location.reload());
  sw.register('sw.js').then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, UPDATE_CHECK_MS);
  }).catch(() => {});
}

boot();
