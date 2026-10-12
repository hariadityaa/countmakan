# Makan Meter

Calorie counter PWA. Take a photo, upload one or type a description. Get calories, protein, carbs and fat back. The repo is still named `countmakan`.
Hari's parents use a setup link. Friends bring their own free Gemini key. DeepSeek is an optional paid backup.

Live at https://hariadityaa.github.io/countmakan/

## How it works
- Static HTML and JS. No build step and no server.
- The browser calls the model APIs directly. API keys stay in the phone's localStorage.
- Photos are resized to 768 px before the call. Only a 200 px thumbnail is stored, in IndexedDB.
- Each estimate is a list of items: name, grams, kcal, protein, carbs, fat, confidence.
- The user can edit every number before saving. Changing grams rescales the rest.
- Each entry stores the provider, model, token usage and response time.
- Settings has daily goals and backup ("Save a copy" / "Restore from a copy").
- Keys, "Test keys", the setup link and the provider order sit in a folded "Setup (API keys)" section. It includes a free Gemini key guide and a folded optional DeepSeek field.

## Screens
- Home: one big "Take a photo" button. "Choose photo" and "Type it in" sit below.
- The photo is shown first ("Is this the right photo?"). Nothing is sent until "Count calories", so a wrong photo costs nothing.
- Loading is a full-screen wait view: "Please wait. You don't need to do anything." Nothing behind it can be tapped.
- Its steps follow real events (sent, looking, results). On fallback the middle step says "Trying another way…". A seconds counter shows it is alive. "Stop and go back" is always there.
- The screen stays awake while waiting (Wake Lock API, where supported).
- Typing a description works without any photo.
- Errors are one plain sentence. The per-provider detail is behind a "Details" toggle.
- Items under 0.6 confidence get a "Please check this" badge.
- Delete is immediate, with an 8 s "Undo".

## Provider chain
Defined in `js/config.js`. Logic never names a model.

| Order | Provider | Model |
|---|---|---|
| 1 | Gemini | `gemini-3.8-flash` |
| 2 | Gemini | `gemini-3.5-flash-lite` |
| 3 | DeepSeek | `deepseek-flash` |

DeepSeek is paid, so it goes last. Its answer is capped at 1,000 tokens.

- The app falls back on 429, 5xx, network errors, a 60 s timeout or unparseable output.
- It stops on other 4xx errors, such as a bad key or bad request.
- It skips a provider with no key, or one whose `supports` list lacks the input type.
- Gemini uses the native `generateContent` endpoint with `responseSchema`. Its OpenAI-compatible endpoint reportedly fails CORS.
- DeepSeek uses `chat/completions` with `response_format: json_object`.

## Using your own free Gemini key
For friends. The same steps are in Settings → "Setup (API keys)". On a phone with no keys, "Use my own key" on the Today tab opens them.
1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with any Google account and accept the terms if asked.
3. Tap "Create API key". Pick the default project if asked.
4. Copy the key. It starts with `AIza`.
5. Paste it into "Gemini API key (free)", then tap "Save keys" and "Test keys".

No credit card is needed. Leave DeepSeek empty unless you have a paid account. The chain skips any provider without a key.

## Setting up a phone
1. On your own phone, open Settings → "Setup (API keys)", paste the keys, then tap "Test keys".
2. Tap "Copy setup link" and send it privately. Parents only ever use this link. It looks like `https://hariadityaa.github.io/countmakan/#setup?gemini=…&deepseek=…`.
3. Opening the link saves the keys and strips them from the address bar. The `#` fragment never reaches a server.
4. Install from the browser menu: "Add to Home screen".

Treat the setup link like a password. Anyone holding it can spend the keys.

## Google Health sync
Optional. Settings → Google Health → Connect. Each phone connects its owner's Google account.

- Each saved meal becomes one nutrition log in the Google Health app, under Food and drink.
- The browser calls `health.googleapis.com` directly. The API allows CORS from the Pages origin.
- Scope: `googlehealth.nutrition.writeonly`. It covers create, list and delete of logs this app wrote.
- Meal type is guessed from the hour: 04–11 breakfast, 11–15 lunch, 18–22 dinner, else snack. The app shows snack as "Other".
- Custom logs can't be edited, so an edit deletes the old log and creates a new one.
- A delete waits 9 s so Undo can cancel it, then removes the remote log.
- Only meals saved while connected are sent. Older and imported meals are not.
- Tokens last 1 hour and a browser can't refresh them. Meals saved after expiry queue up. Today then shows "Send to Google Health".
- Sync is one way. Deleting in Google Health does not touch Makan Meter.

GCP setup (project `makan-meter`, done once):
1. Enable the Google Health API.
2. OAuth consent screen: External, publishing status Testing. Add each user under Test users.
3. Data access: add `googlehealth.nutrition.writeonly`.
4. Web client with JavaScript origin `https://hariadityaa.github.io`. Its ID is in `js/config.js`. It is not a secret.

New users must be added as test users first. Testing mode shows an "unverified app" screen; tap Continue.

## Data and privacy
- Storage keys, the IndexedDB name, the cache name and the export `app` field stay `countmakan`. Renaming them would orphan saved data.
- The free Gemini tier may use inputs, including photos, to improve Google products ([terms](https://ai.google.dev/gemini-api/terms)). Hari accepted this for the parents' phones. Turning on billing for the key stops it. The key guide in Settings says this too.
- Gemini's free-tier caps aren't published. Secondary sources put Flash at about 20 requests a day and Flash-Lite at about 500. Check AI Studio for the real numbers.

## Development
```
npm ci
npm run lint    # eslint
npm run check   # node --check on every file
npm test        # node:test unit tests
npm run e2e     # Playwright, mocked APIs (not in CI yet)
```
Serve locally with any static server, e.g. `python3 -m http.server`.

- `ci.yml` runs lint, syntax checks and tests on every PR.
- `tests/e2e/` covers the setup link, photo and text estimates, fallback, failures, grams rescaling, save/history/delete/undo, backup round trip and offline reload. It uses `/opt/pw-browsers/chromium` when present.
- `e2e-live.yml` runs by hand, or when its own file changes on main. It first waits for Pages to serve the commit. It runs `tests/live/` against the live site with the repo secrets. It makes 3 photo estimates (Commons photos fetched at run time) and 1 text estimate. It reports provider, time, tokens and totals in the job summary, and uploads screenshots as `live-results`. Tick `deepseek_only` on a manual run to load only the DeepSeek key. Every case then runs on DeepSeek, and an answer cut off at `MAX_OUTPUT_TOKENS` fails the run.
- `deploy.yml` deploys Pages from `main` with `actions/deploy-pages`. It stamps the commit into the service-worker cache name.

## Decisions log
- No Cloudflare Worker. Keys live on the device. No passcode.
- DeepSeek is optional. Hari has a paid account. Friends can run on a free Gemini key alone.
- OpenAI and Claude adapters were considered for friends and skipped. A free Gemini key covers most people.
- Workers AI was dropped because it needs Cloudflare.
- Defaults: no daily request cap, English UI, targets for kcal, protein, carbs and fat.
- Eval (Nutrition5k plus weighed home meals) is deferred.
- Google Health sync: one log per meal, meal type from the clock, new meals only. The Google Fit API was rejected: closed to new projects and sunset in 2026.
