// Network-first for same-origin GETs, so updates land on the next load.
// GitHub Pages sends max-age=600, so every fetch revalidates with the server
// instead of trusting the browser's HTTP cache.
// Falls back to cache when offline. API calls (cross-origin) are not touched.
// deploy.yml stamps the commit SHA into CACHE. Readers match the CACHE line.
const CACHE = 'countmakan-v2';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/app.js', 'js/charts.js', 'js/config.js', 'js/prompt.js', 'js/schema.js', 'js/errors.js', 'js/chain.js',
  'js/keys.js', 'js/io.js', 'js/db.js', 'js/image.js', 'js/messages.js', 'js/health.js', 'js/providers/gemini.js', 'js/providers/deepseek.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
