// All model ids live here. Logic never names a model.
// The chain is tried top to bottom. A provider is skipped when it has no key
// or does not support the input type. Fallback happens on 429, 5xx,
// network errors, timeouts and unparseable output.
// timeoutMs caps a step only while a later step can still run. The last
// usable step always gets TIMEOUT_MS, so a single-provider user never loses a slow answer.
export const CHAIN = [
  { provider: 'gemini', model: 'gemini-3.8-flash', supports: ['text', 'image'], timeoutMs: 30000 },
  // Healthy answers take 4-6 s. Past 12 s it has usually hung.
  { provider: 'gemini', model: 'gemini-3.5-flash-lite', supports: ['text', 'image'], timeoutMs: 12000 },
  // Paid, so last. Free Flash-Lite absorbs most Flash 503s.
  { provider: 'deepseek', model: 'deepseek-flash', supports: ['text', 'image'], timeoutMs: 30000 },
];

export const ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  deepseek: 'https://api.deepseek.com/chat/completions',
};

export const PROVIDER_LABELS = { gemini: 'Gemini', deepseek: 'DeepSeek' };

// Shown as optional in Setup. The chain already skips any provider without a key.
export const OPTIONAL_PROVIDERS = ['deepseek'];

export const TIMEOUT_MS = 60000;

// A model that timed out is skipped for this long, while another step can run.
export const COOLDOWN_MS = 10 * 60 * 1000;

// When every step failed and one returned 503, wait this long and retry it once.
// 503s fail fast and often clear within seconds.
export const RETRY_DELAY_MS = 2000;

// Caps paid output. A 10-item answer with sugar, fibre, sodium and a question is about 900 tokens.
export const MAX_OUTPUT_TOKENS = 1500;

export const THUMB_MAX_PX = 200;

// Diary copy stored with each meal.
export const KEEP_MAX_PX = 2048;

// Copy sent to the model. Gemini 3 bills an image by media resolution (about 1,100 tokens
// at most), not pixels, so a bigger file adds upload time and no detail.
export const MODEL_MAX_PX = 1536;
export const MODEL_JPEG_QUALITY = 0.85;

// sugar and sodium are limits. fibre is a minimum. sodium is milligrams.
export const DEFAULT_TARGETS = { kcal: 1800, protein: 60, carbs: 225, fat: 60, sugar: 50, fibre: 25, sodium: 2000 };

// Favourite portions sent with each estimate as a reference. Caps prompt size.
export const MAX_REFS = 20;

// Google Health sync. The client ID is public; Google only accepts it from the
// origins registered in the GCP project (makan-meter).
export const GOOGLE_CLIENT_ID = '949780689105-f1afhqjrdc9aemvatebmveuod2i03tjq.apps.googleusercontent.com';
export const HEALTH_SCOPE = 'https://www.googleapis.com/auth/googlehealth.nutrition.writeonly';
export const HEALTH_API = 'https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints';
