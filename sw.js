const CACHE_NAME = 'pamsimas-v8-fix-install';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@500&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// Install Event: Cache Files
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
        console.log('Opened cache');
        // Gunakan catch agar jika satu file gagal (misal logo.png belum ada), 
        // service worker tetap terinstall agar aplikasi tetap jalan.
        return cache.addAll(urlsToCache).catch(err => {
            console.error('Gagal cache beberapa file:', err);
        });
    })
  );
});

// Activate Event: Cleanup Old Caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        return self.clients.claim();
    })
  );
});

// Fetch Event: Network First, Fallback to Cache
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request);
      })
  );
});