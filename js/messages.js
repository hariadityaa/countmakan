// Plain-English messages for the person using the app.
// Technical detail goes in `details`, shown only behind a toggle.

export const MSG = {
  offline: 'No internet. Check your connection and try again.',
  busy: 'The food checker is busy right now. Try again in a minute.',
  setup: 'The app needs fixing. Please tell Hari.',
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
    ? tried.map((a) => `${a.model}: ${a.error || 'ok'}`).join('\n')
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
