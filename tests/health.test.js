import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// health.js reads localStorage only inside functions, so a shim set before each test works.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const health = await import('../js/health.js');

const NOW = Date.parse('2026-10-12T05:00:00Z');
const at = (h, m = 0) => new Date(2026, 9, 12, h, m).toISOString();
const ITEMS = [
  { name: 'Nasi putih (steamed)', grams: 150, kcal: 195, protein: 4, carbs: 43, fat: 0.4 },
  { name: 'Rendang sapi', grams: 80, kcal: 250, protein: 18, carbs: 4, fat: 18 },
  { name: 'Sambal', grams: 10, kcal: 20, protein: 0.2, carbs: 2, fat: 1.3 },
];
const entry = (id, extra = {}) => ({ id, ts: at(12, 30), items: ITEMS, gh: { state: 'pending' }, ...extra });

function connect() {
  localStorage.setItem('countmakan.health', 'true');
  localStorage.setItem('countmakan.healthToken', JSON.stringify({ token: 'T', exp: NOW + 3600e3 }));
}

// Records calls. reply(method, url, body) returns { status, body }.
function fakeFetch(reply) {
  const calls = [];
  const f = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, url, body, auth: init.headers.authorization });
    const r = reply(init.method, url, body) || { status: 200, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  f.calls = calls;
  return f;
}

function memDb(list) {
  const rows = new Map(list.map((e) => [e.id, structuredClone(e)]));
  return { rows, save: async (e) => (rows.has(e.id) ? (rows.set(e.id, structuredClone(e)), true) : false) };
}

const created = (name) => ({ status: 200, body: { done: true, response: { name } } });

beforeEach(() => mem.clear());

test('meal type follows the local hour', () => {
  assert.equal(health.mealType(at(7)), 'BREAKFAST');
  assert.equal(health.mealType(at(12)), 'LUNCH');
  assert.equal(health.mealType(at(16)), 'SNACK');
  assert.equal(health.mealType(at(19)), 'DINNER');
  assert.equal(health.mealType(at(23)), 'SNACK');
  assert.equal(health.mealType(at(2)), 'SNACK');
});

test('data point carries meal totals, title and local offset', () => {
  const { nutritionLog: n } = health.toDataPoint(entry('a'));
  assert.equal(n.foodDisplayName, 'Rendang sapi, Nasi putih +1 more');
  assert.equal(n.mealType, 'LUNCH');
  assert.deepEqual(n.energy, { kcal: 465 });
  assert.deepEqual(n.totalCarbohydrate, { grams: 49 });
  assert.deepEqual(n.totalFat, { grams: 19.7 });
  assert.deepEqual(n.nutrients, [{ nutrient: 'PROTEIN', quantity: { grams: 22.2 } }]);
  assert.equal(n.interval.startTime, at(12, 30));
  assert.equal(Date.parse(n.interval.endTime) - Date.parse(n.interval.startTime), 60000);
  assert.match(n.interval.startUtcOffset, /^-?\d+s$/);
});

test('sync does nothing while Google Health is off', async () => {
  const f = fakeFetch(() => created('x'));
  const r = await health.sync({ entries: [entry('a')], save: memDb([]).save, fetchImpl: f, now: NOW });
  assert.equal(f.calls.length, 0);
  assert.equal(r.waiting, 0);
});

test('without a valid token, sync asks for sign-in and keeps the meal pending', async () => {
  localStorage.setItem('countmakan.health', 'true');
  const f = fakeFetch(() => created('x'));
  const r = await health.sync({ entries: [entry('a')], save: memDb([]).save, fetchImpl: f, now: NOW });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(r, { waiting: 1, needsSignIn: true });
});

test('a pending meal is created once and stored with its log name', async () => {
  connect();
  const db = memDb([entry('a'), { id: 'old', ts: at(8), items: ITEMS }]);
  const f = fakeFetch(() => created('users/1/dataTypes/nutrition-log/dataPoints/9'));
  const r = await health.sync({ entries: [...db.rows.values()], save: db.save, fetchImpl: f, now: NOW });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].auth, 'Bearer T');
  assert.equal(f.calls[0].body.nutritionLog.energy.kcal, 465);
  assert.deepEqual(db.rows.get('a').gh, { state: 'done', name: 'users/1/dataTypes/nutrition-log/dataPoints/9' });
  assert.equal(db.rows.get('old').gh, undefined); // Saved before sync was on: never sent.
  assert.equal(r.waiting, 0);
});

test('a retry after a lost reply finds the existing log instead of sending twice', async () => {
  connect();
  const e = entry('a', { gh: { state: 'pending', tried: true } });
  const db = memDb([e]);
  const { nutritionLog } = health.toDataPoint(e);
  const f = fakeFetch((method) => (method === 'GET'
    ? { status: 200, body: { dataPoints: [{ name: 'n/1', nutritionLog }] } }
    : created('n/2')));
  await health.sync({ entries: [e], save: db.save, fetchImpl: f, now: NOW });
  assert.deepEqual(f.calls.map((c) => c.method), ['GET']);
  assert.match(decodeURIComponent(f.calls[0].url), /nutrition_log\.interval\.start_time >= "/);
  assert.equal(db.rows.get('a').gh.name, 'n/1');
});

test('deletes wait out the undo window, then go in one batch', async () => {
  connect();
  health.queueDelete('n/1', { now: NOW });
  health.queueDelete('n/2', { now: NOW });
  const f = fakeFetch(() => ({ status: 200, body: { done: true } }));
  await health.sync({ entries: [], save: memDb([]).save, fetchImpl: f, now: NOW + 1000 });
  assert.equal(f.calls.length, 0);
  await health.sync({ entries: [], save: memDb([]).save, fetchImpl: f, now: NOW + health.DELETE_DELAY_MS });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /dataPoints:batchDelete$/);
  assert.deepEqual(f.calls[0].body, { names: ['n/1', 'n/2'] });
  assert.deepEqual(health.queuedDeletes(), []);
});

test('undo inside the window cancels the remote delete', () => {
  health.queueDelete('n/1', { now: NOW });
  assert.equal(health.unqueueDelete('n/1'), true);
  assert.equal(health.unqueueDelete('n/1'), false);
  assert.deepEqual(health.queuedDeletes(), []);
});

test('an expired token clears it and keeps work queued', async () => {
  connect();
  const f = fakeFetch(() => ({ status: 401, body: {} }));
  const db = memDb([entry('a')]);
  const r = await health.sync({ entries: [...db.rows.values()], save: db.save, fetchImpl: f, now: NOW });
  assert.equal(r.needsSignIn, true);
  assert.equal(r.waiting, 1);
  assert.equal(health.validToken(NOW), null);
  assert.equal(db.rows.get('a').gh.state, 'pending');
});

test('a rejected meal is marked failed and not retried', async () => {
  connect();
  const db = memDb([entry('a')]);
  const f = fakeFetch(() => ({ status: 400, body: { error: { message: 'bad kcal' } } }));
  const r = await health.sync({ entries: [...db.rows.values()], save: db.save, fetchImpl: f, now: NOW });
  assert.deepEqual(db.rows.get('a').gh, { state: 'failed', error: 'bad kcal' });
  assert.equal(r.waiting, 0);
});

test('a network error keeps the meal pending and reports it', async () => {
  connect();
  const db = memDb([entry('a')]);
  const f = async () => { throw new TypeError('Failed to fetch'); };
  const r = await health.sync({ entries: [...db.rows.values()], save: db.save, fetchImpl: f, now: NOW });
  assert.equal(r.error, 'Failed to fetch');
  assert.equal(db.rows.get('a').gh.state, 'pending');
  assert.equal(db.rows.get('a').gh.tried, true);
});

test('a meal deleted while sending gets its new log queued for delete', async () => {
  connect();
  const db = memDb([entry('a')]);
  let saves = 0;
  const save = async (e) => (++saves === 1 ? db.save(e) : false);
  await health.sync({ entries: [...db.rows.values()], save, fetchImpl: fakeFetch(() => created('n/9')), now: NOW });
  assert.deepEqual(health.queuedDeletes().map((d) => d.name), ['n/9']);
});

test('paused: connected but nothing is sent, and edits wait for resume', async () => {
  connect();
  health.setPaused(true);
  assert.equal(health.isConnected(), true);
  assert.equal(health.isOn(), false);
  health.queueDelete('n/9', { ripeNow: true, now: NOW });
  const f = fakeFetch(() => created('x'));
  const db = memDb([entry('a')]);
  const r = await health.sync({ entries: [...db.rows.values()], save: db.save, fetchImpl: f, now: NOW });
  assert.equal(f.calls.length, 0);
  assert.equal(r.waiting, 0);
  assert.equal(health.waitingCount([...db.rows.values()]), 2);

  health.setPaused(false);
  await health.sync({ entries: [...db.rows.values()], save: db.save, fetchImpl: f, now: NOW });
  assert.deepEqual(f.calls.map((c) => c.method), ['POST', 'POST']);
  assert.deepEqual(f.calls[0].body, { names: ['n/9'] });
  assert.equal(db.rows.get('a').gh.state, 'done');
});

test('disconnect also clears pause', () => {
  connect();
  health.setPaused(true);
  globalThis.window = {};
  health.disconnect();
  delete globalThis.window;
  connect();
  assert.equal(health.isOn(), true);
});

test('unsent picks never-sent and failed meals inside the day range', () => {
  const now = new Date(2026, 9, 12, 9).getTime();
  const day = (d, h = 12) => new Date(2026, 9, d, h).toISOString();
  const list = [
    { id: 'today', ts: day(12, 8) },
    { id: 'six-days', ts: day(6, 0) },
    { id: 'seven-days', ts: day(5, 23) },
    { id: 'failed', ts: day(11), gh: { state: 'failed' } },
    { id: 'done', ts: day(11), gh: { state: 'done', name: 'n/1' } },
    { id: 'pending', ts: day(11), gh: { state: 'pending' } },
    { id: 'old', ts: day(1) },
  ];
  const ids = (days) => health.unsent(list, days, now).map((e) => e.id);
  assert.deepEqual(ids(7), ['today', 'six-days', 'failed']);
  assert.deepEqual(ids(30), ['today', 'six-days', 'seven-days', 'failed', 'old']);
  assert.deepEqual(ids(null), ids(30));
});

test('sync reports progress after each meal', async () => {
  connect();
  const db = memDb([entry('a'), entry('b', { ts: at(19) })]);
  let n = 0;
  const f = fakeFetch(() => created(`n/${++n}`));
  const seen = [];
  await health.sync({ entries: [...db.rows.values()], save: db.save, onProgress: (w) => seen.push(w), fetchImpl: f, now: NOW });
  assert.deepEqual(seen, [1, 0]);
});
