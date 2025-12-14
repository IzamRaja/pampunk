const CACHE_NAME = 'pamsimas-v22-cleanup';
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
  self.skipWaiting(); // Paksa SW baru untuk segera aktif
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
        console.log('Opened cache: ' + CACHE_NAME);
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
        console.log('Clients claimed.');
        return self.clients.claim();
    })
  );
});

// Fetch Event: Network First for navigations, Stale-While-Revalidate for assets
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });
            }
            return networkResponse;
        }).catch(err => console.log('Fetch failed, using cache only', err));

        return cachedResponse || fetchPromise;
    })
  );
});