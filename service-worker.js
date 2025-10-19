// service-worker.js
const CACHE_NAME = 'leeuwenhoek-escape-v3';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './engine/engine.js', './engine/puzzles.js', './engine/editor.js', './game/scenes.json',
  './assets/workshop.png', './assets/corridor.png', './assets/study.png', './assets/chest_room.png',
  './assets/secret_lab.png', './assets/exit.png', './assets/key_glass.png', './assets/slip1.png',
  './assets/slip2.png', './assets/micro_schema.png', './assets/icon-192.png', './assets/icon-512.png'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))); });
self.addEventListener('fetch', e => { e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
