import { CHAIN, DEFAULT_TARGETS, IMAGE_MAX_PX, THUMB_MAX_PX, PROVIDER_LABELS } from './config.js';
import { estimate, testKey } from './chain.js';
import { totals, scaleItem, normalizeItem } from './schema.js';
import { parseSetupFragment, buildSetupLink, loadKeys, saveKeys, maskKey, PROVIDERS } from './keys.js';
import { buildExport, parseImport, localDay } from './io.js';
import { prepareImage } from './image.js';
import * as db from './db.js';

const $ = (sel) => document.querySelector(sel);
const MACROS = ['kcal', 'protein', 'carbs', 'fat'];
const UNITS = { kcal: 'kcal', protein: 'g', carbs: 'g', fat: 'g', grams: 'g' };
const LABELS = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', grams: 'Grams' };

const state = {
  keys: {},
  targets: { ...DEFAULT_TARGETS },
  entries: [],
  photo: null, // { mime, base64, thumb }
  draft: null, // entry being edited
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
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tab-${name}`;
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

// ---------- Summary ----------
function bar(label, value, target, unit) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return el('div', {},
    el('div', { class: 'bar-label' }, el('span', {}, label), el('span', {}, `${fmt(value)} / ${fmt(target)} ${unit}`)),
    el('div', { class: `bar${target && value > target ? ' over' : ''}` }, el('i', { style: `width:${pct}%` })));
}

function renderSummary() {
  const today = localDay(new Date());
  const t = totals(state.entries.filter((e) => e.day === today).flatMap((e) => e.items));
  const left = state.targets.kcal - t.kcal;
  $('#summary').replaceChildren(
    el('div', { class: 'muted' }, new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })),
    el('div', { class: 'big-num' }, `${fmt(t.kcal)} kcal`),
    el('div', { class: 'muted' }, left >= 0 ? `${fmt(left)} kcal left today` : `${fmt(-left)} kcal over target`),
    el('div', { class: 'bars' }, MACROS.slice(1).map((m) => bar(LABELS[m], t[m], state.targets[m], 'g'))),
  );
}

// ---------- Entry list ----------
function entryRow(e) {
  const t = totals(e.items);
  const names = e.items.map((i) => i.name).join(', ') || e.text || 'Meal';
  const time = new Date(e.ts).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  return el('li', { onclick: () => openEditor(structuredClone(e)) },
    e.thumb ? el('img', { src: e.thumb, alt: '' }) : el('span', { class: 'ph' }, '🍽️'),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, names),
      el('div', { class: 'muted' }, `${time} · P ${fmt(t.protein)} · C ${fmt(t.carbs)} · F ${fmt(t.fat)}`)),
    el('span', { class: 'kcal' }, `${fmt(t.kcal)}`));
}

function renderToday() {
  const today = localDay(new Date());
  const list = state.entries.filter((e) => e.day === today);
  $('#today-list').replaceChildren(...(list.length ? list.map(entryRow) : [el('li', { class: 'muted' }, 'Nothing logged yet.')]));
  renderSummary();
}

function renderHistory() {
  const byDay = new Map();
  for (const e of state.entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const cards = [...byDay.entries()].map(([day, list]) => {
    const t = totals(list.flatMap((e) => e.items));
    const label = new Date(`${day}T12:00:00`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return el('div', { class: 'card' },
      el('div', { class: 'day-head' }, el('h2', {}, label), el('span', { class: 'kcal' }, `${fmt(t.kcal)} kcal`)),
      el('div', { class: 'muted' }, `P ${fmt(t.protein)} g · C ${fmt(t.carbs)} g · F ${fmt(t.fat)} g`),
      el('ul', { class: 'entries' }, list.map(entryRow)));
  });
  $('#history').replaceChildren(...(cards.length ? cards : [el('div', { class: 'card muted' }, 'No history yet.')]));
}

// ---------- Add meal ----------
async function onPhoto(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  setStatus($('#status'), 'Preparing photo…');
  try {
    state.photo = await prepareImage(file, IMAGE_MAX_PX, THUMB_MAX_PX);
    $('#preview-img').src = `data:${state.photo.mime};base64,${state.photo.base64}`;
    $('#preview').hidden = false;
    setStatus($('#status'), '');
  } catch (e) {
    setStatus($('#status'), `Could not read that photo: ${e.message}`, true);
  }
}

function clearPhoto() {
  state.photo = null;
  $('#preview').hidden = true;
  $('#preview-img').removeAttribute('src');
}

async function onEstimate() {
  const text = $('#meal-text').value.trim();
  if (!state.photo && !text) {
    setStatus($('#status'), 'Take a photo or describe the food first.', true);
    return;
  }
  const btn = $('#estimate');
  btn.disabled = true;
  setStatus($('#status'), 'Estimating… this can take 10–30 seconds.');
  try {
    const input = { text, image: state.photo ? { mime: state.photo.mime, base64: state.photo.base64 } : null };
    const out = await estimate(input, state.keys);
    const fellBack = out.attempts.some((a) => a.error);
    setStatus($('#status'), fellBack ? `Used backup: ${out.model}` : '');
    openEditor({
      id: uid(),
      ts: new Date().toISOString(),
      items: out.items,
      provider: out.provider,
      model: out.model,
      source: state.photo ? 'photo' : 'text',
      text,
      thumb: state.photo?.thumb || '',
      isNew: true,
    });
  } catch (e) {
    const detail = (e.attempts || []).filter((a) => a.error).map((a) => `${a.model}: ${a.error}`).join('; ');
    setStatus($('#status'), `${e.message}${detail ? ` (${detail})` : ''}`, true);
  } finally {
    btn.disabled = false;
  }
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
  $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  state.draft = null;
  $('#editor').hidden = true;
  $('#editor').replaceChildren();
}

function numInput(item, field, onChange) {
  return el('div', {},
    el('label', {}, field === 'kcal' ? 'kcal' : `${LABELS[field]} g`),
    el('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: item[field], onchange: (ev) => onChange(ev.target.value) }));
}

function renderEditor() {
  const d = state.draft;
  const box = $('#editor');
  box.hidden = false;
  const items = d.items.map((it, i) => {
    const update = (field) => (v) => {
      d.items[i] = field === 'grams' ? scaleItem(it, v) : normalizeItem({ ...it, [field]: v });
      renderEditor();
    };
    const conf = it.confidence;
    return el('div', { class: 'item' },
      el('div', { class: 'item-head' },
        el('input', { value: it.name, 'aria-label': 'Item name', onchange: (ev) => { d.items[i] = { ...it, name: ev.target.value }; } }),
        el('button', { class: 'btn danger', 'aria-label': `Remove ${it.name}`, onclick: () => { d.items.splice(i, 1); renderEditor(); } }, '✕')),
      el('div', { class: 'grid5' }, ['grams', ...MACROS].map((f) => numInput(it, f, update(f)))),
      el('div', { class: `conf${conf < 0.5 ? ' low' : ''}` }, `Confidence ${Math.round(conf * 100)}%. Changing grams rescales the rest.`));
  });
  const t = totals(d.items);
  box.replaceChildren(
    el('h2', {}, d.isNew ? 'Check the estimate' : 'Edit meal'),
    d.thumb ? el('img', { src: d.thumb, alt: '', style: 'max-width:120px;border-radius:8px' }) : null,
    el('div', { class: 'muted' }, `Estimated by ${PROVIDER_LABELS[d.provider] || d.provider}${d.model ? ` (${d.model})` : ''}`),
    items.length ? items : el('p', { class: 'muted' }, 'No items. Add one below.'),
    el('button', { class: 'link', onclick: () => { d.items.push(normalizeItem({ name: 'New item', confidence: 1 })); renderEditor(); } }, '+ Add item'),
    el('div', { class: 'totals-line' }, `Total: ${fmt(t.kcal)} kcal · P ${fmt(t.protein)} g · C ${fmt(t.carbs)} g · F ${fmt(t.fat)} g`),
    el('label', { for: 'entry-time' }, 'When'),
    el('input', { id: 'entry-time', type: 'datetime-local', value: toLocalInput(d.ts), onchange: (ev) => { if (ev.target.value) d.ts = new Date(ev.target.value).toISOString(); } }),
    el('button', { class: 'btn primary big', onclick: saveDraft }, 'Save'),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: closeEditor }, d.isNew ? 'Discard' : 'Cancel'),
      d.isNew ? null : el('button', { class: 'btn danger', onclick: deleteDraft }, 'Delete')),
  );
}

async function saveDraft() {
  const { isNew, ...entry } = state.draft;
  entry.day = localDay(entry.ts);
  entry.updatedAt = new Date().toISOString();
  await db.putEntry(entry);
  state.entries = await db.allEntries();
  closeEditor();
  if (isNew) {
    clearPhoto();
    $('#meal-text').value = '';
    setStatus($('#status'), 'Saved.');
  }
  renderToday();
}

async function deleteDraft() {
  if (!confirm('Delete this meal?')) return;
  await db.deleteEntry(state.draft.id);
  state.entries = await db.allEntries();
  closeEditor();
  renderToday();
}

// ---------- Settings ----------
function renderSettings() {
  $('#key-gemini').value = state.keys.gemini || '';
  $('#key-deepseek').value = state.keys.deepseek || '';
  $('#key-results').replaceChildren(...PROVIDERS.map((p) => el('li', {}, `${PROVIDER_LABELS[p]}: ${maskKey(state.keys[p])}`)));
  $('#targets').replaceChildren(...MACROS.map((m) => el('div', {},
    el('label', { for: `t-${m}` }, `${LABELS[m]} (${UNITS[m]})`),
    el('input', { id: `t-${m}`, type: 'number', inputmode: 'numeric', min: '0', value: state.targets[m] }))));
  $('#chain').replaceChildren(...CHAIN.map((s) => el('li', {}, `${PROVIDER_LABELS[s.provider]} · ${s.model}${state.keys[s.provider] ? '' : ' (no key)'}`)));
}

function readKeyInputs() {
  return { gemini: $('#key-gemini').value, deepseek: $('#key-deepseek').value };
}

async function onTestKeys() {
  const keys = readKeyInputs();
  const out = $('#key-results');
  out.replaceChildren(el('li', {}, 'Testing…'));
  const rows = await Promise.all(PROVIDERS.map(async (p) => {
    if (!keys[p]) return el('li', {}, `${PROVIDER_LABELS[p]}: not set`);
    const r = await testKey(p, keys[p].trim());
    return el('li', { class: r.ok ? '' : 'error' }, `${r.ok ? '✅' : '❌'} ${PROVIDER_LABELS[p]}: ${r.message}`);
  }));
  out.replaceChildren(...rows);
}

async function onMakeLink() {
  const link = buildSetupLink(location.href, readKeyInputs());
  try {
    await navigator.clipboard.writeText(link);
    alert('Setup link copied. Send it privately.');
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
  alert('Targets saved.');
}

function onExport() {
  const data = buildExport(state.entries, state.targets);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `countmakan-${localDay(new Date())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus($('#io-status'), `Exported ${data.entries.length} meals.`);
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
    setStatus($('#io-status'), `Imported ${entries.length} meals.`);
  } catch (e) {
    setStatus($('#io-status'), e.message, true);
  }
}

// ---------- Boot ----------
async function boot() {
  const fromLink = consumeSetupLink();
  state.keys = loadKeys();
  state.targets = loadTargets();
  state.entries = await db.allEntries();

  for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  $('#camera').addEventListener('change', onPhoto);
  $('#upload').addEventListener('change', onPhoto);
  $('#clear-photo').addEventListener('click', clearPhoto);
  $('#estimate').addEventListener('click', onEstimate);
  $('#save-keys').addEventListener('click', () => {
    state.keys = saveKeys(readKeyInputs());
    renderSettings();
  });
  $('#test-keys').addEventListener('click', onTestKeys);
  $('#make-link').addEventListener('click', onMakeLink);
  $('#save-targets').addEventListener('click', onSaveTargets);
  $('#export').addEventListener('click', onExport);
  $('#import').addEventListener('change', onImport);

  renderToday();
  if (fromLink) {
    showTab('settings');
    $('#key-results').prepend(el('li', {}, '✅ Keys saved from setup link.'));
  } else if (!state.keys.gemini && !state.keys.deepseek) {
    showTab('settings');
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
