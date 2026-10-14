// All model ids live here. Logic never names a model.
// The chain is tried top to bottom. A provider is skipped when it has no key
// or does not support the input type. Fallback happens on 429, 5xx,
// network errors, timeouts and unparseable output.
export const CHAIN = [
  { provider: 'gemini', model: 'gemini-3.8-flash', supports: ['text', 'image'] },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite', supports: ['text', 'image'] },
  // Paid, so last. Free Flash-Lite absorbs most Flash 503s.
  { provider: 'deepseek', model: 'deepseek-flash', supports: ['text', 'image'] },
];

export const ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  deepseek: 'https://api.deepseek.com/chat/completions',
};

export const PROVIDER_LABELS = { gemini: 'Gemini', deepseek: 'DeepSeek' };

// Shown as optional in Setup. The chain already skips any provider without a key.
export const OPTIONAL_PROVIDERS = ['deepseek'];

export const TIMEOUT_MS = 60000;

// Caps paid output. A 10-item answer with sugar, fibre, sodium and a question is about 900 tokens.
export const MAX_OUTPUT_TOKENS = 1500;

export const THUMB_MAX_PX = 200;

// sugar and sodium are limits. fibre is a minimum. sodium is milligrams.
export const DEFAULT_TARGETS = { kcal: 1800, protein: 60, carbs: 225, fat: 60, sugar: 50, fibre: 25, sodium: 2000 };

// Favourite portions sent with each estimate as a reference. Caps prompt size.
export const MAX_REFS = 20;

// Google Health sync. The client ID is public; Google only accepts it from the
// origins registered in the GCP project (makan-meter).
export const GOOGLE_CLIENT_ID = '949780689105-f1afhqjrdc9aemvatebmveuod2i03tjq.apps.googleusercontent.com';
export const HEALTH_SCOPE = 'https://www.googleapis.com/auth/googlehealth.nutrition.writeonly';
export const HEALTH_API = 'https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints';
