import { CHAIN, TIMEOUT_MS } from './config.js';
import { ProviderError, httpError } from './errors.js';
import { parseEstimate, OutputError } from './schema.js';
import * as gemini from './providers/gemini.js';
import * as deepseek from './providers/deepseek.js';

export const ADAPTERS = { gemini, deepseek };

// One call to one provider. Returns { items }.
export async function callProvider(step, input, key, { fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const adapter = ADAPTERS[step.provider];
  if (!adapter) throw new ProviderError(`Unknown provider ${step.provider}`);
  const { url, init } = adapter.buildRequest(step.model, input, key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Timed out' : `Network error: ${e?.message || e}`;
    throw new ProviderError(msg, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body. Handled below.
  }
  if (!res.ok) throw httpError(res.status, adapter.errorDetail(json));
  if (!json) throw new ProviderError('Response was not JSON', { retryable: true });
  try {
    return parseEstimate(adapter.extractText(json));
  } catch (e) {
    if (e instanceof OutputError) throw new ProviderError(e.message, { retryable: true });
    throw e;
  }
}

// Walks the chain. Returns { items, provider, model, attempts }.
// attempts lists every step tried or skipped, for display and debugging.
export async function estimate(input, keys, { chain = CHAIN, fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const kind = input.image ? 'image' : 'text';
  const attempts = [];
  for (const step of chain) {
    const key = keys?.[step.provider];
    if (!key) {
      attempts.push({ ...step, skipped: 'no key' });
      continue;
    }
    if (!step.supports.includes(kind)) {
      attempts.push({ ...step, skipped: `no ${kind} support` });
      continue;
    }
    try {
      const out = await callProvider(step, input, key, { fetchFn, timeoutMs });
      attempts.push({ ...step, ok: true });
      return { ...out, provider: step.provider, model: step.model, attempts };
    } catch (e) {
      attempts.push({ ...step, error: e.message, status: e.status || 0 });
      if (!(e instanceof ProviderError) || !e.retryable) {
        const err = new ProviderError(`${step.model}: ${e.message}`, { status: e.status });
        err.attempts = attempts;
        throw err;
      }
    }
  }
  const tried = attempts.filter((a) => !a.skipped).length;
  const err = new ProviderError(tried ? 'All providers failed' : 'No provider available. Add an API key in Settings.');
  err.attempts = attempts;
  throw err;
}

// Cheap text call per provider to check a key. Returns { ok, message }.
export async function testKey(provider, key, opts = {}) {
  const step = CHAIN.find((s) => s.provider === provider);
  if (!step) return { ok: false, message: 'Not in chain' };
  try {
    const out = await callProvider(step, { text: '1 boiled egg' }, key, opts);
    return { ok: true, message: `${step.model} OK (${out.items[0]?.kcal ?? '?'} kcal)` };
  } catch (e) {
    return { ok: false, message: `${step.model}: ${e.message}` };
  }
}
