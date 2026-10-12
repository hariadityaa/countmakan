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

export const TIMEOUT_MS = 60000;

// Caps paid output. A 10-item answer is about 600 tokens.
export const MAX_OUTPUT_TOKENS = 1000;

// 768 px keeps image tokens down. Plates stay legible at this size.
export const IMAGE_MAX_PX = 768;
export const THUMB_MAX_PX = 200;

export const DEFAULT_TARGETS = { kcal: 1800, protein: 60, carbs: 225, fat: 60 };
