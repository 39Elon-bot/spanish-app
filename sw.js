/* ¡Hablemos! — オフライン対応 Service Worker */
const CACHE = "hablemos-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./app.js",
  "./icon.svg",
  "./apple-touch-icon.png",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// ネットワーク優先、失敗したらキャッシュ(常に最新を使いつつオフラインでも動く)
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
