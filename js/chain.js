import { CHAIN, TIMEOUT_MS, COOLDOWN_MS, RETRY_DELAY_MS } from './config.js';
import { ProviderError, httpError } from './errors.js';
import { parseEstimate, OutputError } from './schema.js';
import * as gemini from './providers/gemini.js';
import * as deepseek from './providers/deepseek.js';

export const ADAPTERS = { gemini, deepseek };

// One call to one provider. Returns { items, usage }.
// signal lets the caller cancel. A cancel is never retried.
export async function callProvider(step, input, key, { fetchFn = fetch, timeoutMs = TIMEOUT_MS, signal } = {}) {
  const adapter = ADAPTERS[step.provider];
  if (!adapter) throw new ProviderError(`Unknown provider ${step.provider}`);
  if (signal?.aborted) throw new ProviderError('Cancelled', { kind: 'cancel' });
  const { url, init } = adapter.buildRequest(step.model, input, key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onCancel = () => ctrl.abort();
  signal?.addEventListener('abort', onCancel);
  let res;
  try {
    res = await fetchFn(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (signal?.aborted) throw new ProviderError('Cancelled', { kind: 'cancel' });
    if (e?.name === 'AbortError') throw new ProviderError('Timed out', { retryable: true, kind: 'timeout' });
    throw new ProviderError(`Network error: ${e?.message || e}`, { retryable: true, kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body. Handled below.
  }
  if (!res.ok) throw httpError(res.status, adapter.errorDetail(json));
  if (!json) throw new ProviderError('Response was not JSON', { retryable: true, kind: 'output' });
  try {
    return { ...parseEstimate(adapter.extractText(json)), usage: adapter.extractUsage?.(json) || null };
  } catch (e) {
    if (e instanceof OutputError) throw new ProviderError(e.message, { retryable: true, kind: 'output' });
    throw e;
  }
}

// A step's stable id, used to save the user's provider order.
export const stepId = (step) => `${step.provider}:${step.model}`;

// Reorders chain by saved ids. Steps not in ids keep their place after the saved ones.
// Saved ids for steps no longer in the chain are dropped.
export function applyOrder(chain, ids) {
  if (!Array.isArray(ids) || !ids.length) return chain;
  const rank = new Map(ids.map((id, i) => [id, i]));
  const known = chain.filter((s) => rank.has(stepId(s))).sort((a, b) => rank.get(stepId(a)) - rank.get(stepId(b)));
  return [...known, ...chain.filter((s) => !rank.has(stepId(s)))];
}

// Walks the chain. Returns { items, usage, provider, model, attempts }.
// Step id -> time it timed out. Lives for the page session.
const timedOut = new Map();

// Resolves after ms, or rejects with a cancel when signal aborts.
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('Cancelled', { kind: 'cancel' }));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onCancel);
      resolve();
    }, ms);
    const onCancel = () => {
      clearTimeout(t);
      reject(new ProviderError('Cancelled', { kind: 'cancel' }));
    };
    signal?.addEventListener('abort', onCancel, { once: true });
  });
}

// attempts lists every step tried or skipped, with ms per real call, for display and debugging.
// onAttempt(step, index) fires before each real call, so the UI can say "trying another way".
// timeoutMs is the budget for the last usable step. Earlier steps use their own shorter cap.
export async function estimate(input, keys, {
  chain = CHAIN, fetchFn = fetch, timeoutMs = TIMEOUT_MS, signal, onAttempt, now = () => performance.now(),
  clock = Date.now, cooldown = timedOut, retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  const kind = input.image ? 'image' : 'text';
  const attempts = [];
  const cooling = (step) => clock() - (cooldown.get(stepId(step)) ?? -Infinity) < COOLDOWN_MS;
  const usable = chain.filter((s) => keys?.[s.provider] && s.supports.includes(kind));
  // Skip recently hung models, unless that would leave nothing to try.
  const fresh = usable.filter((s) => !cooling(s));
  const plan = fresh.length ? fresh : usable;
  const last = plan[plan.length - 1];
  const tries = () => attempts.filter((a) => !a.skipped).length;

  const run = async (step, budget) => {
    const t0 = now();
    const ms = () => Math.round(now() - t0);
    try {
      onAttempt?.(step, tries());
      const out = await callProvider(step, input, keys[step.provider], { fetchFn, timeoutMs: budget, signal });
      attempts.push({ ...step, ok: true, ms: ms() });
      cooldown.delete(stepId(step));
      return { ...out, provider: step.provider, model: step.model, attempts };
    } catch (e) {
      attempts.push({ ...step, error: e.message, status: e.status || 0, kind: e.kind || 'other', ms: ms() });
      if (e.kind === 'timeout') cooldown.set(stepId(step), clock());
      if (!(e instanceof ProviderError) || !e.retryable) {
        const err = new ProviderError(`${step.model}: ${e.message}`, { status: e.status, kind: e.kind });
        err.attempts = attempts;
        throw err;
      }
      return null;
    }
  };

  for (const step of chain) {
    if (!keys?.[step.provider]) {
      attempts.push({ ...step, skipped: 'no key' });
      continue;
    }
    if (!step.supports.includes(kind)) {
      attempts.push({ ...step, skipped: `no ${kind} support` });
      continue;
    }
    if (!plan.includes(step)) {
      attempts.push({ ...step, skipped: 'timed out recently' });
      continue;
    }
    const budget = step === last ? timeoutMs : Math.min(step.timeoutMs ?? timeoutMs, timeoutMs);
    const out = await run(step, budget);
    if (out) return out;
  }

  // Everything failed. A 503 is a fast "busy right now", so one more try is cheap.
  const busy = attempts.find((a) => a.status === 503);
  if (busy) {
    await wait(retryDelayMs, signal).catch((e) => {
      e.attempts = attempts;
      throw e;
    });
    const out = await run(chain.find((s) => stepId(s) === stepId(busy)), timeoutMs);
    if (out) return out;
  }

  const err = new ProviderError(tries() ? 'All providers failed' : 'No provider available. Add an API key in Settings.');
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
