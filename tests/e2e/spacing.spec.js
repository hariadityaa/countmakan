import { test, expect } from '@playwright/test';
import { NASI, geminiBody, mockModels, seedKeys, open, PLATE, mockHealth, connect } from './helpers.js';

// Every card should end where its content ends, plus its own padding.
// Empty status lines or lists must not leave a blank band at the bottom.

// For each visible card: the gap from its last visible ink to its inner bottom edge,
// and from its inner top edge to its first ink. Ink is text, a control, or a box with a border or fill.
// A <summary> counts by its text: its tap area is invisible, so slack around the text reads as blank space.
function cardGaps() {
  const out = [];
  const inks = (card) => {
    let top = Infinity, bottom = -Infinity;
    const add = (r) => { if (r.width > 1 && r.height > 1) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); } };
    const range = document.createRange();
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim() || !n.parentElement.checkVisibility()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) add(r);
    }
    for (const e of card.querySelectorAll('*')) {
      if (!e.checkVisibility({ opacityProperty: true })) continue;
      const s = getComputedStyle(e);
      const boxed = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0
        || s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.backgroundImage !== 'none'
        || e.matches('button, input, select, textarea, svg, canvas, img, .btn');
      if (boxed) add(e.getBoundingClientRect());
    }
    return { top, bottom };
  };
  for (const card of document.querySelectorAll('.card')) {
    if (!card.checkVisibility()) continue;
    const s = getComputedStyle(card);
    const r = card.getBoundingClientRect();
    const ink = inks(card);
    if (ink.bottom === -Infinity) continue;
    out.push({
      card: card.id || card.querySelector('h2, summary')?.textContent.trim() || card.className,
      top: Math.round(ink.top - r.top - parseFloat(s.borderTopWidth)),
      bottom: Math.round(r.bottom - parseFloat(s.borderBottomWidth) - ink.bottom),
    });
  }
  return out;
}

// Content sits 24px (--s-6) from a card's bottom edge, give or take a few px of line-height.
const EDGE = 24;
const SLACK = 4;
const loose = (gaps) => gaps.filter((g) => g.bottom > EDGE + SLACK || g.bottom < EDGE - 1)
  .map((g) => `${g.card}: ${g.bottom}px below content, want ${EDGE}px`);

// Visible empty paragraphs and lists that still push things apart.
function emptySpacers() {
  const out = [];
  for (const e of document.querySelectorAll('main :is(p, ul, ol, div)')) {
    if (!e.checkVisibility() || e.children.length || e.textContent.trim()) continue;
    const s = getComputedStyle(e);
    const space = e.getBoundingClientRect().height + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
    if (space > 0) out.push(`#${e.id || e.className} takes ${Math.round(space)}px`);
  }
  return out;
}

async function check(page, label) {
  const gaps = await page.evaluate(cardGaps);
  if (process.env.SPACING_DUMP) console.log(label, JSON.stringify(gaps));
  expect.soft(loose(gaps), label).toEqual([]);
  expect.soft(await page.evaluate(emptySpacers), `${label}: empty spacers`).toEqual([]);
}

for (const width of [360, 412]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    test.beforeEach(async ({ page }) => seedKeys(page));

    test('no card has a blank band under its content', async ({ page }) => {
      const body = geminiBody(NASI);
      body.candidates[0].content.parts[0].text = JSON.stringify({ items: NASI, question: 'How much rice did you eat?', choices: ['Half plate', 'Full plate', 'Extra rice'] });
      await mockModels(page, { 'gemini-3.8-flash': { status: 200, body } });
      await open(page);
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        e.prompt = async () => {};
        e.userChoice = Promise.resolve({ outcome: 'dismissed' });
        window.dispatchEvent(e);
      });
      // The update banner needs a new service worker; layout only needs it shown.
      await page.evaluate(() => { document.querySelector('#update').hidden = false; });
      await check(page, 'home');
      await page.evaluate(() => { document.querySelector('#update').hidden = true; });

      await page.locator('nav button[data-tab=history]').click();
      await check(page, 'history empty');
      await page.locator('nav button[data-tab=settings]').click();
      await check(page, 'settings');
      await page.locator('#suggest > summary').click();
      await check(page, 'settings, suggest open');
      await page.locator('#setup > summary').click();
      await check(page, 'settings, setup open');
      await page.locator('#backup > summary').click();
      await page.locator('#export').click();
      await expect(page.locator('#io-status')).not.toBeEmpty();
      await check(page, 'settings, after save a copy');

      await page.locator('nav button[data-tab=today]').click();
      await page.setInputFiles('#upload', PLATE);
      await expect(page.locator('#compose')).toBeVisible();
      await check(page, 'photo check');
      await page.getByRole('button', { name: 'Count calories' }).click();
      await expect(page.locator('#editor-total')).toBeVisible();
      await check(page, 'results');
      await page.getByRole('button', { name: 'Save as a favourite' }).click();
      await page.getByRole('button', { name: 'Save meal' }).click();
      await expect(page.locator('#favs')).toBeVisible();
      await expect(page.locator('#today-list .entry')).toHaveCount(1);
      await check(page, 'saved');

      await page.locator('#today-list .entry').first().click();
      await check(page, 'edit meal');
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Type', exact: true }).click();
      await check(page, 'type it in');
      await page.getByRole('button', { name: 'Cancel' }).click();

      await page.locator('nav button[data-tab=history]').click();
      await check(page, 'history');
    });

    test('no card has a blank band with Google Health connected', async ({ page }) => {
      await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
      await mockHealth(page);
      await open(page);
      // A meal saved before connecting, so Send past meals has something to offer.
      await page.setInputFiles('#upload', PLATE);
      await page.getByRole('button', { name: 'Count calories' }).click();
      await page.getByRole('button', { name: 'Save meal' }).click();
      await expect(page.locator('#today-list .entry')).toHaveCount(1);
      await connect(page);
      await expect(page.locator('#health-past')).toBeVisible();
      await check(page, 'health on, past meals');
      await page.getByRole('button', { name: 'Send 1 meal' }).click();
      await expect(page.locator('#health-past')).toBeHidden();
      await check(page, 'health on');
      await page.getByRole('switch', { name: 'Send new meals' }).uncheck();
      await check(page, 'health off');
    });

    test('no card has a blank band on the Google Health send card', async ({ page }) => {
      await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
      await mockHealth(page);
      // Was connected, but this session has no sign-in yet: saved meals wait on Today.
      await page.addInitScript(() => {
        localStorage.setItem('countmakan.health', 'true');
        window.gisClosed = true; // The sign-in popup on Save is closed.
      });
      await open(page);
      await page.setInputFiles('#upload', PLATE);
      await page.getByRole('button', { name: 'Count calories' }).click();
      await page.getByRole('button', { name: 'Save meal' }).click();
      await expect(page.locator('#health-sync')).toBeVisible();
      await check(page, 'health send card');
    });

    test('no card has a blank band before setup', async ({ page }) => {
      await page.addInitScript(() => localStorage.removeItem('countmakan.keys'));
      await open(page);
      await expect(page.locator('#not-set-up')).toBeVisible();
      await check(page, 'not set up');
    });

    test('no card has a blank band on the failure screen', async ({ page }) => {
      await mockModels(page, {});
      await open(page);
      await page.setInputFiles('#upload', PLATE);
      await page.getByRole('button', { name: 'Count calories' }).click();
      await expect(page.locator('#failure')).toBeVisible();
      await check(page, 'failure');
    });
  });
}
