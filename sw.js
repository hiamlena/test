// file: sw.js
const CACHE_VERSION = 'tt-2025-12-08-v2'; // Обновляем версию
const STATIC_CACHE = `tt-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `tt-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './diag.html',
  './csp-report.php',
  './config.js',
  './errors.js',
  './assets/js/boot.js',
  './assets/js/core.js',
  './assets/js/yandex.js',
  './assets/js/layers.js',
  './assets/js/ui.js',
  './assets/js/router.js',
  './assets/js/storage.js',
  './assets/css/style.css',
  './data/frames_ready.geojson',
  './data/hgv_allowed.geojson',
  './data/hgv_conditional.geojson',
  './data/roads_ufo_hgv.geojson'
];

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');
}

function isYandexMapsRequest(url) {
  return (
    url.hostname.includes('yandex.ru') ||
    url.hostname.includes('yastatic.net') ||
    url.hostname.includes('api-maps.yandex')
  );
}

function matchCache(cacheName, request) {
  return caches.open(cacheName).then(cache => cache.match(request));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => {
        console.log('[SW] Precache завершён');
      })
      .catch(err => {
        console.error('[SW] Ошибка при precache:', err);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith('tt-static-') || key.startsWith('tt-runtime-'))
            .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.origin !== self.location.origin) {
    if (isYandexMapsRequest(url)) {
      event.respondWith(
        fetch(request).catch(() => matchCache(STATIC_CACHE, request))
      );
    }
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          matchCache(STATIC_CACHE, request)
            .then(cached => cached || matchCache(STATIC_CACHE, './diag.html'))
        )
    );
    return;
  }

  // Кэшируем ТОЛЬКО 200 OK и не HTML
  event.respondWith(
    matchCache(STATIC_CACHE, request)
      .then(cached => {
        if (cached) return cached;

        return fetch(request)
          .then(response => {
            // Кэшируем только успешные ответы с правильным типом
            if (
              response.ok &&
              response.status === 200 &&
              !response.url.endsWith('sw.js') &&
              !response.headers.get('content-type')?.includes('text/html')
            ) {
              const clone = response.clone();
              caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => matchCache(STATIC_CACHE, request));
      })
  );
});
