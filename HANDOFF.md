# countmakan handoff

Calorie-counter PWA for Hari's parents (Indonesia). Photo, upload or text in. Calories and macros out.

## Status
- Nothing is built yet. The branch holds only `.github/workflows/setup-check.yml`, a temporary check. Delete it before the build PR.
- The repo is public. The default branch `main` has no commits yet.

## Verified on 2026-10-12
- Pages is on, source = GitHub Actions. URL: https://hariadityaa.github.io/countmakan/
- Repo secrets `GEMINI_API_KEY` and `DEEPSEEK_API_KEY` are present. Both return HTTP 200.
- Browser calls work from the Pages origin. A CORS preflight from `https://hariadityaa.github.io` is allowed by:
  - Gemini native `v1beta/models/{model}:generateContent`, header `x-goog-api-key`. The OpenAI-compatible endpoint reportedly fails CORS, so don't use it.
  - DeepSeek `https://api.deepseek.com/chat/completions`, `Authorization: Bearer`. It's OpenAI-format.
- Models visible to the keys:
  - Gemini: `gemini-3.8-flash`, `gemini-3.5-flash-lite`. Also 3.6 and 3.7 flash, and `-latest` aliases.
  - DeepSeek: `deepseek-flash`, `deepseek-v4-pro`.
- Pin exact ids in config. Don't use the `-latest` aliases.
- Not yet verified with a real image call:
  - that `deepseek-flash` accepts images (third-party sources say only Flash does);
  - the exact Gemini `inline_data` field names.
- Gemini free-tier limits aren't published any more. Secondary sources say Flash is about 20 requests/day and Flash-Lite about 500/day. Hari can confirm the real caps in AI Studio.
- The cloud sandbox's network policy blocks ai.google.dev, developers.cloudflare.com and api.deepseek.com. generativelanguage.googleapis.com is reachable. Run DeepSeek calls from GitHub Actions.

## Decisions made by Hari
- **No Cloudflare Worker.** Keys live on-device (option A). A one-time setup link carries the keys in the URL `#` fragment and stores them in localStorage, then strips the link from the address bar. Also add a manual paste-keys screen and a "test keys" button. No passcode.
- **DeepSeek allowed.** Hari has a paid DeepSeek account.
- **Workers AI dropped,** because it needs Cloudflare.
- **Proposed provider chain:** `gemini-3.8-flash`, then `deepseek-flash`, then `gemini-3.5-flash-lite`. Fall back on 429, 5xx or a network error. The chain is config-driven, with no model ids hardcoded in logic. Each provider is an adapter with one shared output schema.

## Awaiting Hari's confirmation (ask before building)
- **D1:** the chain order above.
- **D3:** accept that the free Gemini tier may use photos to improve Google products.
- **D4:** run the eval on Nutrition5k images first (known nutrition values), then 10 weighed meals from his parents. Compute their true values from the Singapore HPB and Indonesian TKPI composition tables.
- Defaults assumed: no daily cap, English UI, targets for kcal, protein, carbs and fat.

## Spec
- Static HTML/JS PWA, installable. `<input type="file" accept="image/*" capture>` for camera, plus upload and a text box.
- Resize photos to about 1024 px before the API call. Store only a small thumbnail (about 200 px) in IndexedDB.
- Structured JSON per estimate: items[{name, grams, kcal, protein, carbs, fat, confidence}]. Use Gemini's `responseSchema` and DeepSeek's JSON mode.
- The user can edit any estimate before saving. Show a daily total and a history list.
- JSON export and import.
- Prompt context: Singapore hawker dishes and Indonesian dishes, with typical portions.
- Store provider and model on each entry.
- CI: syntax and lint checks plus unit tests. Deploy Pages from main via actions/deploy-pages.

## Eval
- Run each photo through every provider. Error = the gap between estimate and truth, divided by truth, for kcal and each macro.
- Flag anything above 30%.
- Output a colour-coded .xlsx with providers side by side. Check every number line by line.

## Workflow (Hari's preferences)
- Plan and draft in chat first. Ask for decisions in the form Problem → Context → Options → Recommendation.
- After pushing: open a PR, wait for CI, squash-merge when green, then confirm the Pages deploy. No need to ask first.
- Writing style: short sentences, no em-dash asides, bullets, cite sources.
