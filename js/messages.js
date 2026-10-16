// Plain-English messages for the person using the app.
// Technical detail goes in `details`, shown only behind a toggle.

export const MSG = {
  offline: 'No internet. Check your connection and try again.',
  busy: 'The food checker is busy right now. Try again in a minute.',
  setup: 'The app needs fixing. Check the keys in Settings, or tell Hari.',
  unreadable: "We couldn't read this photo. Try another photo, or type what you ate.",
  noFood: "We couldn't see any food. Try another photo, or type what you ate.",
  photo: "We couldn't open that photo. Try another one.",
  other: 'Something went wrong. Try again.',
};

// Turns a failed estimate into { kind, text, details }.
// online is navigator.onLine. It is passed in so this stays testable.
export function describeFailure(err, online = true) {
  const tried = (err?.attempts || []).filter((a) => !a.skipped);
  const details = tried.length
    ? tried.map((a) => `${a.model}: ${a.error || 'ok'}${a.ms != null ? ` (${secs(a.ms)})` : ''}`).join('\n')
    : String(err?.message || err || 'Unknown error');
  const kind = classify(tried, online);
  return { kind, text: MSG[kind], details };
}

function classify(tried, online) {
  if (!online) return 'offline';
  if (!tried.length) return 'setup';
  const kinds = tried.map((a) => a.kind);
  if (kinds.every((k) => k === 'network')) return 'offline';
  const last = tried[tried.length - 1];
  // A non-retryable 4xx (bad key, bad request) stops the chain.
  if (last.kind === 'http' && last.status >= 400 && last.status < 500 && last.status !== 429) return 'setup';
  if (kinds.every((k) => k === 'output')) return 'unreadable';
  if (kinds.some((k) => k === 'http' || k === 'timeout' || k === 'network' || k === 'output')) return 'busy';
  return 'other';
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

// One line on how a scan went, for the editor and the console.
// e.g. "gemini-3.8-flash timed out after 60.0 s → gemini-3.5-flash-lite 6.2 s · photo 340 KB · 1,200 thinking tokens"
export function scanSummary(attempts = [], { photoBytes, usage } = {}) {
  const steps = attempts.filter((a) => !a.skipped || a.skipped === 'timed out recently').map((a) => {
    if (a.skipped) return `${a.model} skipped (timed out recently)`;
    const t = a.ms != null ? secs(a.ms) : '';
    if (a.ok) return `${a.model} ${t}`.trim();
    const why = a.kind === 'timeout' ? 'timed out' : a.status ? `failed (${a.status})` : `failed (${a.error || a.kind})`;
    return `${a.model} ${why}${t ? ` after ${t}` : ''}`;
  });
  const parts = [steps.join(' → ')];
  if (photoBytes) parts.push(`photo ${Math.round(photoBytes / 1024).toLocaleString('en')} KB`);
  const thinking = usage?.thinking ?? usage?.reasoning;
  if (thinking) parts.push(`${thinking.toLocaleString('en')} thinking tokens`);
  return parts.filter(Boolean).join(' · ');
}
