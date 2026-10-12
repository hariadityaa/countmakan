const STORE_KEY = 'countmakan.keys';
export const PROVIDERS = ['gemini', 'deepseek'];

// Parses "#setup?gemini=...&deepseek=..." into { gemini, deepseek }.
// Returns null when the fragment is not a setup link.
export function parseSetupFragment(hash) {
  if (!hash || !hash.startsWith('#setup')) return null;
  const q = hash.slice('#setup'.length).replace(/^[?&]/, '');
  const params = new URLSearchParams(q);
  const keys = {};
  for (const p of PROVIDERS) {
    const v = (params.get(p) || '').trim();
    if (v) keys[p] = v;
  }
  return Object.keys(keys).length ? keys : null;
}

export function buildSetupLink(baseUrl, keys) {
  const params = new URLSearchParams();
  for (const p of PROVIDERS) if (keys[p]) params.set(p, keys[p]);
  return `${baseUrl.split('#')[0]}#setup?${params.toString()}`;
}

export function loadKeys(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveKeys(keys, storage = globalThis.localStorage) {
  const clean = {};
  for (const p of PROVIDERS) if (keys[p]) clean[p] = String(keys[p]).trim();
  storage.setItem(STORE_KEY, JSON.stringify(clean));
  return clean;
}

export function maskKey(k) {
  if (!k) return 'not set';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}
