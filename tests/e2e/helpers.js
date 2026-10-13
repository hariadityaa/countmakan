import { expect } from '@playwright/test';

export const PLATE = new URL('./fixtures/plate.jpg', import.meta.url).pathname;
export const KEYS = { gemini: 'AIza-test-gemini-key', deepseek: 'sk-test-deepseek-key' };

export const NASI = [
  { name: 'Nasi putih', grams: 150, kcal: 195, protein: 4, carbs: 43, fat: 0.4, confidence: 0.9 },
  { name: 'Rendang sapi', grams: 80, kcal: 250, protein: 18, carbs: 4, fat: 18, confidence: 0.4 },
];

export const geminiBody = (items) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }],
  usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 120 },
});
export const deepseekBody = (items) => ({
  choices: [{ message: { content: JSON.stringify({ items }) } }],
  usage: { prompt_tokens: 900, completion_tokens: 130 },
});

// plan maps a model id to a response: { status, body } or 'hang'.
// Returns the list of models called, in order.
export async function mockModels(page, plan) {
  const calls = [];
  await page.route(/generativelanguage\.googleapis\.com|api\.deepseek\.com/, async (route) => {
    const req = route.request();
    const model = req.url().includes('/models/')
      ? decodeURIComponent(req.url().split('/models/')[1].split(':')[0])
      : JSON.parse(req.postData()).model;
    calls.push(model);
    const r = plan[model] || { status: 500, body: { error: { message: `no mock for ${model}` } } };
    if (r === 'hang') return;
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  return calls;
}

export async function seedKeys(page, keys = KEYS) {
  await page.addInitScript((k) => {
    if (!localStorage.getItem('countmakan.keys')) localStorage.setItem('countmakan.keys', JSON.stringify(k));
  }, keys);
}

export async function open(page, path = '') {
  await page.goto(path);
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
}

export async function photoEstimate(page) {
  await page.setInputFiles('#upload', PLATE);
  await expect(page.getByRole('heading', { name: 'Is this the right photo?' })).toBeVisible();
  await page.getByRole('button', { name: 'Count calories' }).click();
}
