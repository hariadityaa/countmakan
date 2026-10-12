import { CHAIN, DEFAULT_TARGETS, IMAGE_MAX_PX, THUMB_MAX_PX, PROVIDER_LABELS, OPTIONAL_PROVIDERS } from './config.js';
import { estimate, testKey } from './chain.js';
import { totals, scaleItem, normalizeItem, mealTitle } from './schema.js';
import { parseSetupFragment, buildSetupLink, loadKeys, saveKeys, maskKey, PROVIDERS } from './keys.js';
import { buildExport, parseImport, localDay } from './io.js';
import { prepareImage } from './image.js';
import { describeFailure, MSG } from './messages.js';
import * as db from './db.js';
import * as health from './health.js';

const $ = (sel) => document.querySelector(sel);
const MACROS = ['kcal', 'protein', 'carbs', 'fat'];
const GOAL_LABELS = { kcal: 'Calories', protein: 'Protein (g)', carbs: 'Carbs (g)', fat: 'Fat (g)' };
const LOW_CONFIDENCE = 0.6;
const SLOW_MS = 30000;
const UNDO_MS = 8000;

const state = {
  keys: {},
  targets: { ...DEFAULT_TARGETS },
  entries: [],
  photo: null, // { mime, base64, thumb }
  draft: null, // entry being edited
  abort: null, // AbortController for the running estimate
  health: { waiting: 0, needsSignIn: false, error: '' },
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
const macroLine = (t) => `Protein ${fmt(t.protein)} g · Carbs ${fmt(t.carbs)} g · Fat ${fmt(t.fat)} g`;
const hasKeys = () => PROVIDERS.some((p) => state.keys[p]);

function setStatus(node, msg, isError = false) {
  node.textContent = msg;
  node.classList.toggle('error', isError);
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
  // While waiting, the rest of the app can't be tapped or reached by keyboard.
  const busy = step === 'loading';
  document.body.classList.toggle('is-busy', busy);
  for (const n of [$('header.top'), $('main')]) n.inert = busy;
  if (step === 'add') $('#add').hidden = !hasKeys();
  // Summary and meal list only on the home step, so each step has one job.
  $('#summary').hidden = step !== 'add';
  $('#health-sync').hidden = step !== 'add' || !showSyncCard();
  $('#meals').hidden = step !== 'add';
  $('#not-set-up').hidden = hasKeys();
  $('#welcome').hidden = !hasKeys() || state.entries.length > 0 || step !== 'add';
}

function resetAdd() {
  state.photo = null;
  state.draft = null;
  $('#preview-img').removeAttribute('src');
  $('#meal-text').value = '';
  $('#compose-error').textContent = '';
  showStep('add');
}

// ---------- Summary ----------
function bar(label, value, target) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return el('div', {},
    el('div', { class: 'bar-label' }, el('span', {}, label), el('span', {}, `${fmt(value)} g of ${fmt(target)} g`)),
    el('div', { class: `bar${target && value > target ? ' over' : ''}`, 'aria-hidden': 'true' }, el('i', { style: `width:${pct}%` })));
}

function renderSummary() {
  const today = localDay(new Date());
  const t = totals(state.entries.filter((e) => e.day === today).flatMap((e) => e.items));
  const goal = state.targets.kcal;
  const left = goal - t.kcal;
  $('#summary').replaceChildren(
    el('div', { class: 'muted' }, `Today, ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`),
    el('div', { class: 'big-num' }, fmt(t.kcal), ' ', el('small', {}, 'calories')),
    el('div', {}, left >= 0 ? `${fmt(left)} left of your ${fmt(goal)} goal` : `${fmt(-left)} over your ${fmt(goal)} goal`),
    el('div', { class: 'bars' },
      bar('Protein', t.protein, state.targets.protein),
      bar('Carbs', t.carbs, state.targets.carbs),
      bar('Fat', t.fat, state.targets.fat)),
  );
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
  $('#today-list').replaceChildren(...(list.length ? list.map(entryRow) : [el('li', { class: 'empty' }, 'No meals yet today.')]));
  renderSummary();
  if (!$('#add').hidden || !$('#welcome').hidden || !$('#not-set-up').hidden) showStep('add');
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
    return el('div', { class: 'card' },
      el('div', { class: 'day-head' }, el('h2', {}, label), el('span', { class: 'day-total' }, `${fmt(t.kcal)} calories`)),
      el('div', { class: 'muted' }, macroLine(t)),
      el('ul', { class: 'entries' }, list.map(entryRow)));
  });
  $('#history').replaceChildren(...(cards.length ? cards : [el('div', { class: 'card empty' }, 'No meals saved yet.')]));
}

// ---------- Add a meal ----------
async function onPhoto(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    state.photo = await prepareImage(file, IMAGE_MAX_PX, THUMB_MAX_PX);
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

async function onEstimate() {
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
    const input = { text, image: photo ? { mime: state.photo.mime, base64: state.photo.base64 } : null };
    const out = await estimate(input, state.keys, {
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
    if (!out.items.length) {
      showFailure({ text: MSG.noFood, details: `${out.model}: returned no items` });
      return;
    }
    openEditor({
      id: uid(),
      ts: new Date().toISOString(),
      items: out.items,
      provider: out.provider,
      model: out.model,
      usage: out.usage,
      ms: Math.round(performance.now() - started),
      source: photo ? 'photo' : 'text',
      text,
      thumb: state.photo?.thumb || '',
      isNew: true,
    });
  } catch (e) {
    if (abort.signal.aborted) return; // Stop already moved the screen back.
    showFailure(describeFailure(e, navigator.onLine));
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
  showStep('compose');
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
  state.draft = entry;
  showTab('today');
  renderEditor();
  showStep('editor');
  $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  state.draft = null;
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
      renderEditor();
    };
    const id = (f) => `item-${i}-${f}`;
    return el('div', { class: 'item' },
      el('label', { for: id('name') }, 'Food'),
      el('input', { id: id('name'), value: it.name, onchange: (ev) => { d.items[i] = { ...it, name: ev.target.value }; } }),
      it.detail ? el('div', { class: 'item-detail' }, it.detail) : null,
      it.confidence < LOW_CONFIDENCE ? el('span', { class: 'badge' }, 'Please check this') : null,
      el('div', { class: 'item-cals' },
        field(id('grams'), 'Grams', it.grams, update('grams')),
        field(id('kcal'), 'Calories', it.kcal, update('kcal'))),
      el('div', { class: 'item-macros' },
        field(id('protein'), 'Protein g', it.protein, update('protein')),
        field(id('carbs'), 'Carbs g', it.carbs, update('carbs')),
        field(id('fat'), 'Fat g', it.fat, update('fat'))),
      el('button', { type: 'button', class: 'btn danger', 'aria-label': `Remove this food: ${it.name}`, onclick: () => { d.items.splice(i, 1); renderEditor(); } }, 'Remove this food'));
  });
  const t = totals(d.items);
  $('#editor').replaceChildren(...[
    el('h2', {}, d.isNew ? "Here's what we found" : 'Change this meal'),
    d.thumb ? el('img', { class: 'editor-photo', src: d.thumb, alt: 'Your meal' }) : null,
    el('p', { class: 'muted' }, 'If a portion looks wrong, change the grams. The other numbers update by themselves.'),
    items.length ? items : el('p', { class: 'empty' }, 'No food in this meal. Add one below.'),
    el('button', { type: 'button', class: 'btn', onclick: () => { d.items.push(normalizeItem({ name: 'Food', confidence: 1 })); renderEditor(); } }, '+ Add another food'),
    el('p', { class: 'total', id: 'editor-total' }, `Total: ${fmt(t.kcal)} calories`),
    el('p', { class: 'total-sub' }, macroLine(t)),
    el('label', { for: 'entry-time' }, 'Time eaten'),
    el('input', { id: 'entry-time', type: 'datetime-local', value: toLocalInput(d.ts), onchange: (ev) => { if (ev.target.value) d.ts = new Date(ev.target.value).toISOString(); } }),
    el('button', { type: 'button', class: 'btn primary', id: 'save-meal', onclick: saveDraft }, d.isNew ? 'Save meal' : 'Save changes'),
    el('button', { type: 'button', class: 'btn', onclick: closeEditor }, d.isNew ? "Don't save" : 'Cancel'),
    d.isNew ? null : el('button', { type: 'button', class: 'btn danger', onclick: deleteDraft }, 'Delete this meal'),
  ].flat().filter(Boolean));
}

async function saveDraft() {
  // Commit an edit that is still focused, so its change event runs first.
  document.activeElement?.blur?.();
  const { isNew, ...entry } = state.draft;
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

async function syncHealth() {
  if (!health.isOn()) return;
  state.health = await health.sync({
    entries: state.entries,
    save: async (e) => {
      if (!(await db.getEntry(e.id))) return false;
      await db.putEntry(e);
      return true;
    },
  });
  state.entries = await db.allEntries();
  renderHealth();
}

function renderHealth() {
  const { waiting, error } = state.health;
  $('#health-sync-text').textContent = `${changes(waiting)} not in Google Health yet.`;
  $('#health-sync').hidden = $('#summary').hidden || !showSyncCard();
  const on = health.isOn();
  const failed = state.entries.filter((e) => e.gh?.state === 'failed').length;
  const lines = on
    ? ['On. New meals also go to the Google Health app.',
      waiting ? `${changes(waiting)} waiting to send.` : '',
      failed ? `${changes(failed)} could not be sent.` : '',
      error ? `Last try failed: ${error}` : '']
    : ['Send each new meal to the Google Health app.'];
  $('#health-status').textContent = lines.filter(Boolean).join(' ');
  $('#health-connect').hidden = on;
  $('#health-disconnect').hidden = !on;
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
  $('#targets').replaceChildren(...MACROS.map((m) => el('div', {},
    el('label', { for: `t-${m}` }, GOAL_LABELS[m]),
    el('input', { id: `t-${m}`, type: 'number', inputmode: 'numeric', min: '0', value: state.targets[m] }))));
  health.preload().catch(() => {});
  renderHealth();
  if (!state.keys.gemini) $('#gemini-guide').open = true;
  if (state.keys.deepseek) $('#deepseek-section').open = true;
  $('#chain').replaceChildren(...CHAIN.map((s) => el('li', {}, `${PROVIDER_LABELS[s.provider]} · ${s.model}${keyNote(s.provider)}`)));
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
  for (const m of MACROS) {
    const v = Number($(`#t-${m}`).value);
    if (v > 0) state.targets[m] = v;
  }
  localStorage.setItem('countmakan.targets', JSON.stringify(state.targets));
  renderSummary();
  toast('Goals saved ✓');
}

function onExport() {
  const data = buildExport(state.entries, state.targets);
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
    const { entries, targets } = parseImport(await file.text());
    await db.putMany(entries);
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
// installed app (turisfasih on hariadityaa.github.io). The page prompt checks scope correctly.
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

// ---------- Boot ----------
async function boot() {
  const fromLink = consumeSetupLink();
  state.keys = loadKeys();
  state.targets = loadTargets();
  state.entries = await db.allEntries();

  for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  for (const id of ['#camera', '#upload', '#replace']) $(id).addEventListener('change', onPhoto);
  $('#type-meal').addEventListener('click', () => openCompose(false));
  $('#cancel-compose').addEventListener('click', resetAdd);
  $('#estimate').addEventListener('click', onEstimate);
  $('#cancel-estimate').addEventListener('click', cancelEstimate);
  $('#retry').addEventListener('click', onEstimate);
  $('#start-over').addEventListener('click', resetAdd);
  $('#save-keys').addEventListener('click', () => {
    state.keys = saveKeys(readKeyInputs());
    renderSettings();
    showStep('add');
    toast('Keys saved ✓');
  });
  $('#test-keys').addEventListener('click', onTestKeys);
  $('#make-link').addEventListener('click', onMakeLink);
  $('#own-key').addEventListener('click', openOwnKeySetup);
  $('#save-targets').addEventListener('click', onSaveTargets);
  $('#export').addEventListener('click', onExport);
  $('#import').addEventListener('change', onImport);
  $('#install-yes').addEventListener('click', onInstall);
  $('#install-no').addEventListener('click', onDeclineInstall);
  $('#health-connect').addEventListener('click', () => onHealthSignIn('Connected to Google Health ✓'));
  $('#health-disconnect').addEventListener('click', onHealthDisconnect);
  $('#health-sync-btn').addEventListener('click', () => onHealthSignIn('Sent to Google Health ✓'));
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

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
