// Sends saved meals to the Google Health app, one nutrition log per meal.
// Each synced entry carries gh: { state: 'pending' | 'done' | 'failed', name, tried }.
// Entries without gh were saved while sync was off. Only "Send past meals" sends them.
// Browser APIs are touched only inside functions, so node tests can import this.
import { GOOGLE_CLIENT_ID, HEALTH_SCOPE, HEALTH_API } from './config.js';
import { totals, mealTitle } from './schema.js';

const ON_KEY = 'countmakan.health';
const TOKEN_KEY = 'countmakan.healthToken';
const DELETES_KEY = 'countmakan.healthDeletes';
const PAUSED_KEY = 'countmakan.healthPaused';

// A deleted meal waits this long before its remote delete, so Undo can cancel it.
export const DELETE_DELAY_MS = 9000;

// ---------- Mapping ----------
// Guessed from the local hour eaten. Google Health shows SNACK as "Other".
export function mealType(date) {
  const h = new Date(date).getHours();
  if (h >= 4 && h < 11) return 'BREAKFAST';
  if (h >= 11 && h < 15) return 'LUNCH';
  if (h >= 18 && h < 22) return 'DINNER';
  return 'SNACK';
}

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const utcOffset = (d) => `${-d.getTimezoneOffset() * 60}s`;

export function toDataPoint(entry) {
  const start = new Date(entry.ts);
  const end = new Date(start.getTime() + 60000);
  const t = totals(entry.items);
  const { title, more } = mealTitle(entry.items, entry.text);
  return {
    nutritionLog: {
      interval: { startTime: start.toISOString(), endTime: end.toISOString(), startUtcOffset: utcOffset(start), endUtcOffset: utcOffset(end) },
      foodDisplayName: more ? `${title} +${more} more` : title,
      mealType: mealType(start),
      energy: { kcal: r1(t.kcal) },
      totalCarbohydrate: { grams: r1(t.carbs) },
      totalFat: { grams: r1(t.fat) },
      nutrients: [{ nutrient: 'PROTEIN', quantity: { grams: r1(t.protein) } }],
    },
  };
}

// ---------- Storage ----------
function get(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function set(key, v) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch { /* storage blocked */ }
}

// Connected keeps the Google consent. On also means sending: connected and not paused.
export const isConnected = () => get(ON_KEY) === true;
export const isPaused = () => isConnected() && get(PAUSED_KEY) === true;
export const isOn = () => isConnected() && !isPaused();
export const setPaused = (v) => set(PAUSED_KEY, v ? true : null);

// Edits and deletes queued for meals already sent. They go out when sync is on.
export const waitingCount = (entries) => entries.filter((e) => e.gh?.state === 'pending').length + queuedDeletes().length;

// Meals never sent, or rejected, saved in the last `days` local days. Null days means all.
export function unsent(entries, days, now = Date.now()) {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (days) from.setDate(from.getDate() - days + 1);
  return entries.filter((e) => (!e.gh || e.gh.state === 'failed') && (!days || Date.parse(e.ts) >= from.getTime()));
}

export function validToken(now = Date.now()) {
  const t = get(TOKEN_KEY);
  return t && t.exp - 60000 > now ? t.token : null;
}

export const queuedDeletes = () => get(DELETES_KEY) || [];

// ripeNow skips the Undo wait, for edits that replace a log.
export function queueDelete(name, { ripeNow = false, now = Date.now() } = {}) {
  set(DELETES_KEY, [...queuedDeletes(), { name, at: ripeNow ? now - DELETE_DELAY_MS : now }]);
}

// True when the delete was still queued, so the remote log is untouched.
export function unqueueDelete(name) {
  const q = queuedDeletes();
  const left = q.filter((d) => d.name !== name);
  set(DELETES_KEY, left);
  return left.length < q.length;
}

// ---------- Sign-in ----------
let gisPromise;
export function preload() {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new Error('Could not load Google sign-in'));
      };
      document.head.append(s);
    });
  }
  return gisPromise;
}

// Opens Google's popup. After the first consent it usually closes by itself.
export async function getToken() {
  await preload();
  const oauth2 = window.google.accounts.oauth2;
  return new Promise((resolve, reject) => {
    oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: HEALTH_SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'No token'));
        if (!oauth2.hasGrantedAllScopes(r, HEALTH_SCOPE)) return reject(new Error('Permission was not given'));
        set(TOKEN_KEY, { token: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 });
        set(ON_KEY, true);
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Sign-in was closed' : e?.message || 'Sign-in failed')),
    }).requestAccessToken({ prompt: '' });
  });
}

export function disconnect() {
  const token = validToken();
  if (token) window.google?.accounts?.oauth2?.revoke(token, () => {});
  set(ON_KEY, null);
  set(PAUSED_KEY, null);
  set(TOKEN_KEY, null);
  set(DELETES_KEY, null);
}

// ---------- API ----------
export class AuthError extends Error {}

async function call(fetchImpl, token, method, url, body) {
  const res = await fetchImpl(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError('Google sign-in expired');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error?.message || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

const permanent = (e) => !(e instanceof AuthError) && e.status >= 400 && e.status < 500;

export async function createLog(fetchImpl, token, entry) {
  const op = await call(fetchImpl, token, 'POST', HEALTH_API, toDataPoint(entry));
  return op?.response?.name || null;
}

// After a send whose reply was lost, looks for the log by start time and name.
export async function findLog(fetchImpl, token, entry) {
  const { nutritionLog: want } = toDataPoint(entry);
  const start = want.interval.startTime;
  const until = new Date(Date.parse(start) + 1000).toISOString();
  const filter = `nutrition_log.interval.start_time >= "${start}" AND nutrition_log.interval.start_time < "${until}"`;
  let data;
  try {
    data = await call(fetchImpl, token, 'GET', `${HEALTH_API}?pageSize=50&filter=${encodeURIComponent(filter)}`);
  } catch (e) {
    if (!permanent(e)) throw e;
    data = await call(fetchImpl, token, 'GET', `${HEALTH_API}?pageSize=200`); // Filter refused: scan recent logs.
  }
  const hit = (data.dataPoints || []).find((p) => p.nutritionLog?.foodDisplayName === want.foodDisplayName
    && Date.parse(p.nutritionLog?.interval?.startTime) === Date.parse(start));
  return hit?.name || null;
}

export const deleteLogs = (fetchImpl, token, names) => call(fetchImpl, token, 'POST', `${HEALTH_API}:batchDelete`, { names });

// ---------- Sync ----------
// save(entry) writes an entry back and returns false if it was deleted meanwhile.
// onProgress(waiting) runs after each meal, so a long send can show what is left.
// Returns { waiting, needsSignIn, error }.
let running = null;
export function sync(deps) {
  if (!running) running = runSync(deps).finally(() => { running = null; });
  return running;
}

async function runSync({ entries, save, onProgress = () => {}, fetchImpl = fetch, now = Date.now() }) {
  const pending = entries.filter((e) => e.gh?.state === 'pending');
  const ripe = queuedDeletes().filter((d) => now - d.at >= DELETE_DELAY_MS);
  const waiting = () => waitingCount(entries);
  if (!isOn() || (!pending.length && !ripe.length)) return { waiting: isOn() ? waiting() : 0 };
  const token = validToken(now);
  if (!token) return { waiting: waiting(), needsSignIn: true };

  try {
    if (ripe.length) {
      try {
        await deleteLogs(fetchImpl, token, ripe.map((d) => d.name));
      } catch (e) {
        if (!permanent(e)) throw e; // A 4xx here means the logs are already gone or invalid.
      }
      const done = new Set(ripe.map((d) => d.name));
      set(DELETES_KEY, queuedDeletes().filter((d) => !done.has(d.name)));
    }
    for (const e of pending) {
      let name = e.gh.tried ? await findLog(fetchImpl, token, e) : null;
      if (!name) {
        if (!(await save({ ...e, gh: { state: 'pending', tried: true } }))) continue;
        try {
          name = await createLog(fetchImpl, token, e);
        } catch (err) {
          if (!permanent(err)) throw err;
          e.gh = { state: 'failed', error: err.message };
          await save(e);
          onProgress(waiting());
          continue;
        }
      }
      if (!name) continue; // Accepted but not finished. findLog picks it up next time.
      e.gh = { state: 'done', name };
      if (!(await save(e))) queueDelete(name, { ripeNow: true }); // Deleted while sending.
      onProgress(waiting());
    }
    return { waiting: waiting() };
  } catch (e) {
    if (e instanceof AuthError) {
      set(TOKEN_KEY, null);
      return { waiting: waiting(), needsSignIn: true };
    }
    return { waiting: waiting(), error: e.message };
  }
}
