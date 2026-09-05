// service-worker.js
//
// NOTE: 15 of the 19 paths below do not exist. cache.addAll() is atomic, so
// install always rejects and ?pwa=1 is a silent no-op today. Whether this file
// is repaired or removed is EI-007, an open decision, so the list is left as it
// is rather than half-fixed. Only the cache name, which said leeuwenhoek, was
// made neutral (EI-015).
const CACHE_NAME = 'escape-game-engine-v3';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './engine/engine.js', './engine/puzzles.js', './engine/editor.js', './game/scenes.json',
  './assets/workshop.jpg', './assets/corridor.jpg', './assets/study.jpg', './assets/chest_room.jpg',
  './assets/secret_lab.jpg', './assets/exit.jpg', './assets/key_glass.jpg', './assets/slip1.jpg',
  './assets/slip2.jpg', './assets/micro_schema.jpg', './assets/icon-192.jpg', './assets/icon-512.jpg'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))); });
self.addEventListener('fetch', e => { e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
