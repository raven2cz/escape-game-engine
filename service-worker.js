// service-worker.js
const CACHE_NAME = 'leeuwenhoek-escape-v3';
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
