// Offline cache for My Paycheck. Bump VERSION when files change.
const VERSION = 'mypaycheck-v1';
const FILES = ['./', './index.html', './engine.js', './parser.js', './pdf.min.mjs', './pdf.worker.min.mjs',
  './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
